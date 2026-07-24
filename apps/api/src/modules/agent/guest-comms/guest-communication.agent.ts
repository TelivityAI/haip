// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, gte, not, inArray } from 'drizzle-orm';
import {
  reservations,
  guests,
  properties,
  roomTypes,
  ratePlans,
  bookings,
  agentDecisions,
} from '@inhotel-io/database';
import { DRIZZLE } from '../../../database/database.module';
import { AgentService } from '../agent.service';
import { EmailService } from './email.service';
import type {
  HaipAgent,
  AgentContext,
  AgentAnalysis,
  AgentDecisionInput,
  AgentDecisionRecord,
  ExecutionResult,
  AgentOutcome,
  TrainingResult,
} from '../interfaces/haip-agent.interface';
import {
  generateEmailDraft,
  getEmailTypeForEvent,
  getDefaultCommunicationConfig,
  type EmailType,
  type GuestContext,
  type ReservationContext,
  type PropertyContext,
  type CommunicationConfig,
} from './guest-communication.models';

@Injectable()
export class GuestCommunicationAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'guest_comms';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, context?: AgentContext): Promise<AgentAnalysis> {
    // Determine which email type to generate
    const eventName = context?.eventPayload?.['event'] as string | undefined;
    const reservationId = context?.eventPayload?.['reservationId'] as string | undefined;
    const emailType = eventName ? getEmailTypeForEvent(eventName) : null;

    // Get property info
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));

    // Get agent config for enabled types
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const commConfig: CommunicationConfig = {
      ...getDefaultCommunicationConfig(),
      ...(config.config as object),
    };

    // Get target reservations
    let targetReservations: any[];
    if (reservationId) {
      // Single reservation from event trigger
      targetReservations = await this.db
        .select()
        .from(reservations)
        .where(
          and(
            eq(reservations.id, reservationId),
            eq(reservations.propertyId, propertyId),
          ),
        );
    } else {
      // Manual/scheduled run: get active reservations needing communication
      const today = new Date().toISOString().split('T')[0]!;
      targetReservations = await this.db
        .select()
        .from(reservations)
        .where(
          and(
            eq(reservations.propertyId, propertyId),
            gte(reservations.arrivalDate, today),
            not(inArray(reservations.status, ['cancelled', 'no_show'] as any)),
          ),
        );
    }

    // Get guest data
    const guestIds = [...new Set(targetReservations.map((r: any) => r.guestId).filter(Boolean))];
    const guestData: any[] = guestIds.length > 0
      ? await this.db.select().from(guests).where(inArray(guests.id, guestIds as any))
      : [];
    const guestMap = new Map(guestData.map((g: any) => [g.id, g]));

    // Get booking data for confirmation numbers
    const bookingIds = [...new Set(targetReservations.map((r: any) => r.bookingId).filter(Boolean))];
    const bookingData: any[] = bookingIds.length > 0
      ? await this.db.select().from(bookings).where(inArray(bookings.id, bookingIds as any))
      : [];
    const bookingMap = new Map(bookingData.map((b: any) => [b.id, b]));

    // Get room type names
    const rtIds = [...new Set(targetReservations.map((r: any) => r.roomTypeId).filter(Boolean))];
    const rtData: any[] = rtIds.length > 0
      ? await this.db.select().from(roomTypes).where(inArray(roomTypes.id, rtIds as any))
      : [];
    const rtMap = new Map(rtData.map((rt: any) => [rt.id, rt]));

    // Get rate plan names
    const rpIds = [...new Set(targetReservations.map((r: any) => r.ratePlanId).filter(Boolean))];
    const rpData: any[] = rpIds.length > 0
      ? await this.db.select().from(ratePlans).where(inArray(ratePlans.id, rpIds as any))
      : [];
    const rpMap = new Map(rpData.map((rp: any) => [rp.id, rp]));

    // Get previous communications for these reservations (to avoid duplicates)
    // Only consider approved/auto_executed decisions as "sent" — not pending/rejected/failed
    const previousComms = await this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.propertyId, propertyId),
          eq(agentDecisions.agentType, 'guest_comms' as any),
          inArray(agentDecisions.status, ['approved', 'auto_executed'] as any),
        ),
      );
    // Map: reservationId → set of email types already sent
    const sentMap = new Map<string, EmailType[]>();
    for (const d of previousComms) {
      const rec = d.recommendation as any;
      if (rec?.reservationId && rec?.emailType) {
        const existing = sentMap.get(rec.reservationId) ?? [];
        existing.push(rec.emailType);
        sentMap.set(rec.reservationId, existing);
      }
    }

    // Count past stays per guest for repeat detection
    const allRes = await this.db
      .select({ guestId: reservations.guestId, status: reservations.status })
      .from(reservations)
      .where(eq(reservations.propertyId, propertyId));
    const pastStayCounts = new Map<string, number>();
    for (const r of allRes) {
      if (r.guestId && r.status === 'checked_out') {
        pastStayCounts.set(r.guestId, (pastStayCounts.get(r.guestId) ?? 0) + 1);
      }
    }

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        emailType,
        property,
        commConfig,
        targetReservations,
        guestMap: Object.fromEntries(guestMap),
        bookingMap: Object.fromEntries(bookingMap),
        rtMap: Object.fromEntries(rtMap),
        rpMap: Object.fromEntries(rpMap),
        sentMap: Object.fromEntries(sentMap),
        pastStayCounts: Object.fromEntries(pastStayCounts),
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const {
      emailType: triggeredType,
      property,
      commConfig,
      targetReservations,
      guestMap,
      bookingMap,
      rtMap,
      rpMap,
      sentMap,
      pastStayCounts,
    } = analysis.signals as any;

    if (!property || targetReservations.length === 0) return [];

    const decisions: AgentDecisionInput[] = [];
    const enabledTypes: EmailType[] = commConfig.enabledTypes ?? ['confirmation', 'pre_arrival', 'post_stay'];

    for (const res of targetReservations) {
      const guest = guestMap[res.guestId];
      if (!guest || !guest.email) continue;

      const booking = bookingMap[res.bookingId];
      const roomType = rtMap[res.roomTypeId];
      const ratePlan = rpMap[res.ratePlanId];
      const previousTypes: EmailType[] = sentMap[res.id] ?? [];
      const pastStays: number = pastStayCounts[res.guestId] ?? 0;

      // Determine which email types to generate
      const typesToGenerate: EmailType[] = [];
      if (triggeredType) {
        // Event-driven: single type
        if (enabledTypes.includes(triggeredType)) {
          typesToGenerate.push(triggeredType);
        }
      } else {
        // Scheduled/manual: check all enabled types for pre_arrival
        const daysUntil = Math.ceil(
          (new Date(res.arrivalDate).getTime() - Date.now()) / 86400000,
        );
        if (enabledTypes.includes('pre_arrival') && daysUntil <= (commConfig.preArrivalDaysBefore ?? 3) && daysUntil > 0) {
          typesToGenerate.push('pre_arrival');
        }
        if (enabledTypes.includes('day_of') && daysUntil === 0) {
          typesToGenerate.push('day_of');
        }
      }

      const guestCtx: GuestContext = {
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        vipLevel: guest.vipLevel ?? 'none',
        isRepeatGuest: pastStays > 0,
        pastStayCount: pastStays,
        gdprConsentMarketing: guest.gdprConsentMarketing ?? false,
        preferences: guest.preferences,
      };

      const resCtx: ReservationContext = {
        id: res.id,
        arrivalDate: res.arrivalDate,
        departureDate: res.departureDate,
        nights: res.nights,
        roomTypeName: roomType?.name ?? 'Standard Room',
        ratePlanName: ratePlan?.name ?? 'Standard Rate',
        totalAmount: res.totalAmount ?? '0.00',
        currencyCode: res.currencyCode ?? 'USD',
        specialRequests: res.specialRequests,
        confirmationNumber: booking?.confirmationNumber ?? res.id.slice(0, 8),
      };

      const propCtx: PropertyContext = {
        name: property.name,
        checkInTime: property.checkInTime ?? '15:00',
        checkOutTime: property.checkOutTime ?? '11:00',
        phone: property.phone,
        email: property.email,
        website: property.website,
        addressLine1: property.addressLine1,
        city: property.city,
      };

      for (const type of typesToGenerate) {
        const draft = generateEmailDraft(type, guestCtx, resCtx, propCtx, commConfig, previousTypes);
        if (!draft) continue;

        decisions.push({
          decisionType: 'guest_communication',
          recommendation: {
            reservationId: res.id,
            guestId: res.guestId,
            emailType: draft.emailType,
            to: draft.to,
            subject: draft.subject,
            bodyHtml: draft.bodyHtml,
            bodyText: draft.bodyText,
            personalizationTokens: draft.personalizationTokens,
          },
          confidence: 0.90, // template-based = high confidence
          inputSnapshot: {
            reservationId: res.id,
            guestName: `${guest.firstName} ${guest.lastName}`,
            emailType: draft.emailType,
            isRepeatGuest: guestCtx.isRepeatGuest,
            analyzedAt: analysis.timestamp.toISOString(),
          },
        });
      }
    }

    return decisions;
  }

  async execute(decision: AgentDecisionRecord): Promise<ExecutionResult> {
    const rec = decision.recommendation as any;

    if (!this.emailService.isConfigured()) {
      return {
        success: true,
        changes: [{ entity: 'email', action: 'drafted', detail: `Email drafted for ${rec.to} (SMTP not configured)` }],
      };
    }

    const result = await this.emailService.send({
      to: rec.to,
      subject: rec.subject,
      html: rec.bodyHtml,
      text: rec.bodyText,
    });

    return {
      success: result.sent,
      changes: [{
        entity: 'email',
        action: result.sent ? 'sent' : 'failed',
        detail: result.sent
          ? `Email sent to ${rec.to} (${rec.emailType})`
          : `Failed: ${result.error}`,
      }],
      error: result.error,
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'guest-comms-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return getDefaultCommunicationConfig() as unknown as Record<string, unknown>;
  }
}
