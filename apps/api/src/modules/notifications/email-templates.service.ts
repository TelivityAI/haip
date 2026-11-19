import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { agentConfigs, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';

/** Lifecycle email types the guest-communication agent knows how to send. */
export const EMAIL_TYPES = [
  'confirmation',
  'pre_arrival',
  'day_of',
  'welcome',
  'post_stay',
  'win_back',
] as const;

export type EmailTypeKey = (typeof EMAIL_TYPES)[number];

export interface EmailTemplateOverride {
  subject?: string;
  firstTime?: string;
  repeat?: string;
  enabled?: boolean;
}

/** Tokens a hotel may use in its own copy. Kept in sync with generateEmailDraft's token map. */
export const EMAIL_TEMPLATE_TOKENS = [
  'first_name',
  'last_name',
  'property_name',
  'confirmation_number',
  'arrival_date',
  'departure_date',
  'nights',
  'room_type',
  'total_amount',
  'currency',
  'check_in_time',
  'check_out_time',
  'property_phone',
  'property_email',
  'property_address',
  'property_website',
  'days_until',
  'days_since',
  'special_requests_line',
  'local_tips_section',
  'upsell_section',
  'check_in_section',
  'review_links',
] as const;

const EMAIL_AGENT_TYPE = 'guest_comms';
const TOKEN_RE = /\{([a-z0-9_]+)\}/g;

/** Unknown `{token}`s would ship a literal brace to a real guest — reject them up front. */
export function unknownTemplateTokens(text: string): string[] {
  const known = new Set<string>(EMAIL_TEMPLATE_TOKENS);
  const found = new Set<string>();
  for (const match of String(text ?? '').matchAll(TOKEN_RE)) {
    const token = match[1]!;
    if (!known.has(token)) found.add(token);
  }
  return [...found];
}

/**
 * Per-property lifecycle email wording.
 *
 * The templates themselves live in code (guest-communication.models.ts); a hotel's
 * overrides are stored on the `guest_comms` agent config so there is no extra table
 * and the agent that sends the mail reads them from its own config row.
 */
@Injectable()
export class EmailTemplatesService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  private assertEmailType(emailType: string): EmailTypeKey {
    if (!(EMAIL_TYPES as readonly string[]).includes(emailType)) {
      throw new BadRequestException(
        `Unknown email type '${emailType}'. Valid: ${EMAIL_TYPES.join(', ')}`,
      );
    }
    return emailType as EmailTypeKey;
  }

  private async configRow(propertyId: string, create: boolean) {
    const [existing] = await this.db
      .select()
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.propertyId, propertyId),
          eq(agentConfigs.agentType, EMAIL_AGENT_TYPE as never),
        ),
      );
    if (existing) return existing;
    if (!create) return null;
    await this.db
      .insert(agentConfigs)
      .values({
        propertyId,
        agentType: EMAIL_AGENT_TYPE as never,
        isEnabled: false,
        mode: 'suggest',
        config: {},
      })
      .onConflictDoNothing();
    const [created] = await this.db
      .select()
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.propertyId, propertyId),
          eq(agentConfigs.agentType, EMAIL_AGENT_TYPE as never),
        ),
      );
    return created ?? null;
  }

  private overridesOf(row: Record<string, unknown> | null): Record<string, EmailTemplateOverride> {
    const config = (row?.['config'] ?? {}) as Record<string, unknown>;
    const raw = config['customTemplates'];
    return raw && typeof raw === 'object' ? (raw as Record<string, EmailTemplateOverride>) : {};
  }

  async list(propertyId: string) {
    const row = await this.configRow(propertyId, false);
    const overrides = this.overridesOf(row);

    const templates = EMAIL_TYPES.map((emailType) => {
      const override = overrides[emailType] ?? null;
      return {
        emailType,
        subject: override?.subject ?? null,
        bodyFirstTime: override?.firstTime ?? null,
        bodyRepeat: override?.repeat ?? null,
        enabled: override?.enabled ?? null,
        isCustomized: Boolean(override),
      };
    });

    return {
      count: templates.length,
      templates,
      availableTokens: EMAIL_TEMPLATE_TOKENS,
      note:
        'A null subject/body means the built-in default for that email type is used. ' +
        'Only the fields you send are overridden; the rest stay default.',
    };
  }

  async update(
    propertyId: string,
    emailTypeRaw: string,
    patch: {
      enabled?: boolean;
      subject?: string;
      bodyFirstTime?: string;
      bodyRepeat?: string;
    },
    actor?: AuditActor,
  ) {
    const emailType = this.assertEmailType(emailTypeRaw);
    if (
      patch.enabled === undefined &&
      patch.subject === undefined &&
      patch.bodyFirstTime === undefined &&
      patch.bodyRepeat === undefined
    ) {
      throw new BadRequestException(
        'Nothing to update: send at least one of enabled, subject, bodyFirstTime, bodyRepeat.',
      );
    }

    const unknown = new Set<string>();
    for (const text of [patch.subject, patch.bodyFirstTime, patch.bodyRepeat]) {
      if (text === undefined) continue;
      for (const token of unknownTemplateTokens(text)) unknown.add(token);
    }
    if (unknown.size > 0) {
      throw new BadRequestException(
        `Unknown template token(s): ${[...unknown].join(', ')}. ` +
          `Valid tokens: ${EMAIL_TEMPLATE_TOKENS.join(', ')}`,
      );
    }

    const row = await this.configRow(propertyId, true);
    if (!row) throw new NotFoundException(`No guest-comms config for property ${propertyId}`);

    const config = {
      ...((row['config'] as Record<string, unknown>) ?? {}),
    } as Record<string, unknown>;
    const current = this.overridesOf(row);
    const nextOverride: EmailTemplateOverride = {
      ...(current[emailType] ?? {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.bodyFirstTime !== undefined ? { firstTime: patch.bodyFirstTime } : {}),
      ...(patch.bodyRepeat !== undefined ? { repeat: patch.bodyRepeat } : {}),
    };
    config['customTemplates'] = { ...current, [emailType]: nextOverride };

    const [updated] = await this.db
      .update(agentConfigs)
      .set({ config, updatedAt: new Date() })
      .where(eq(agentConfigs.id, row['id']))
      .returning();

    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'email_template',
      entityId: row['id'],
      description: `email_template.updated (${emailType})`,
      previousValue: { emailType, override: current[emailType] ?? null },
      newValue: { emailType, override: nextOverride },
      ...actorFields(actor),
    });

    return {
      emailType,
      override: nextOverride,
      isCustomized: true,
      agentConfigId: updated?.['id'] ?? row['id'],
    };
  }
}
