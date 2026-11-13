import { Injectable, Inject } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { auditRuns, properties } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { AllotmentService } from '../groups/allotment.service';
import { NightAuditService } from './night-audit.service';
import {
  addCalendarDays,
  planNightAuditWindow,
  type NightAuditSettings,
} from './night-audit-clock';

export interface RunDueInput {
  forceWindow?: boolean;
  maxCatchupDays?: number;
  now?: Date;
}

export interface RunDueFailure {
  propertyId: string;
  businessDate?: string;
  error: string;
  closedDates: string[];
}

export interface RunDueResult {
  ok: boolean;
  totalProperties: number;
  closedProperties: number;
  skippedBeforeCutoff: number;
  failures: RunDueFailure[];
}

type PropertyRow = {
  id: string;
  timezone: string | null;
  settings: { nightAudit?: NightAuditSettings } | null;
};

@Injectable()
export class NightAuditSchedulerService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly nightAudit: NightAuditService,
    private readonly allotments: AllotmentService,
  ) {}

  async runDue(input: RunDueInput = {}): Promise<RunDueResult> {
    const now = input.now ?? new Date();
    const maxCatchupDays = input.maxCatchupDays ?? 14;
    const rows: PropertyRow[] = await this.db
      .select({
        id: properties.id,
        timezone: properties.timezone,
        settings: properties.settings,
      })
      .from(properties)
      .where(eq(properties.isActive, true));

    const eligible = rows.filter((row) => row.settings?.nightAudit?.autoCloseEnabled !== false);
    let closedProperties = 0;
    let skippedBeforeCutoff = 0;
    const failures: RunDueFailure[] = [];

    for (const property of eligible) {
      const lastClosed = await this.latestCompletedDate(property.id);
      const plan = planNightAuditWindow({
        timeZone: property.timezone,
        settings: property.settings?.nightAudit,
        now,
        lastClosed,
        forceWindow: input.forceWindow,
        maxCatchupDays,
      });
      if (plan.action === 'disabled') continue;
      if (plan.action === 'invalid_timezone') {
        failures.push({ propertyId: property.id, error: plan.error, closedDates: [] });
        continue;
      }
      if (plan.action === 'skip_cutoff') {
        skippedBeforeCutoff += 1;
        continue;
      }

      const closedDates: string[] = [];
      let failed = false;
      for (const businessDate of plan.dates) {
        try {
          await this.nightAudit.runAudit({
            propertyId: property.id,
            businessDate,
            mode: 'unattended',
          });
          closedDates.push(businessDate);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/already completed/i.test(message)) {
            closedDates.push(businessDate);
            continue;
          }
          failures.push({
            propertyId: property.id,
            businessDate,
            error: message,
            closedDates,
          });
          failed = true;
          break;
        }
      }
      if (failed) continue;

      const openDate = await this.openBusinessDate(property.id, plan.localToday);
      if (openDate !== plan.localToday) {
        failures.push({
          propertyId: property.id,
          error: `open_business_date ${openDate ?? 'none'} is not ${plan.localToday}`,
          closedDates,
        });
        continue;
      }

      try {
        await this.allotments.processCutoffs(property.id);
      } catch (error) {
        failures.push({
          propertyId: property.id,
          error: error instanceof Error ? error.message : String(error),
          closedDates,
        });
        continue;
      }
      closedProperties += 1;
    }

    return {
      ok: failures.length === 0,
      totalProperties: eligible.length,
      closedProperties,
      skippedBeforeCutoff,
      failures,
    };
  }

  private async latestCompletedDate(propertyId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ businessDate: auditRuns.businessDate })
      .from(auditRuns)
      .where(and(eq(auditRuns.propertyId, propertyId), eq(auditRuns.status, 'completed' as any)))
      .orderBy(desc(auditRuns.businessDate))
      .limit(1);
    return row?.businessDate ? String(row.businessDate).slice(0, 10) : null;
  }

  private async openBusinessDate(propertyId: string, fallback: string): Promise<string | null> {
    const last = await this.latestCompletedDate(propertyId);
    if (!last) return fallback;
    return addCalendarDays(last, 1);
  }
}
