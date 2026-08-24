import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  auditLogs,
  bookingEngineConfig,
  bookingRequestConsequences,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
  reservations,
} from '@telivityhaip/database';
import type {
  AcceptedPricingSnapshot,
  BookingFormQuestion,
  PaymentMethodCollection,
} from '@telivityhaip/database';
import { createHash } from 'node:crypto';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  actorFields,
  type AuditActor,
} from '../../common/audit/audit-actor';
import { DRIZZLE } from '../../database/database.module';
import { AncillaryService } from '../ancillary/ancillary.service';
import { reservationServiceAttachedPayload } from '../ancillary/reservation-service-event';
import { BookingEngineConfigService } from '../booking-engine/booking-engine-config.service';
import { BookingEngineService } from '../booking-engine/booking-engine.service';
import {
  validateApplicationAnswers,
  validateQuestionDefinitions,
} from '../booking-engine/booking-form-questions';
import {
  SAVED_PAYMENT_METHOD_GATEWAY,
  type SavedPaymentMethod,
  type SavedPaymentMethodGateway,
} from '../payment/interfaces/saved-payment-method-gateway.interface';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import { FolioService } from '../folio/folio.service';
import { GuestService } from '../guest/guest.service';
import { AvailabilityService } from '../reservation/availability.service';
import { ReservationService } from '../reservation/reservation.service';
import {
  WebhookService,
  type WebhookPayload,
} from '../webhook/webhook.service';
import { assertCanonicalStayDates } from './booking-request-date.validator';
import {
  assertDenialMoneyResolved,
  type BookingRequestPriceSource,
} from './booking-request-money';
import { assertBookingRequestTransition } from './booking-request-state';
import { buildAcceptedPricingSnapshot } from './booking-request-pricing';
import type { AcceptBookingRequestDto } from './dto/accept-booking-request.dto';
import type { CreateRequestCardSetupDto } from './dto/create-request-card-setup.dto';
import type { DenyBookingRequestDto } from './dto/deny-booking-request.dto';
import type { ListBookingRequestsDto } from './dto/list-booking-requests.dto';
import type { SubmitBookingRequestDto } from './dto/submit-booking-request.dto';
import {
  toAcceptedBookingRequestDecision,
  toBookingRequestDetail,
  toBookingRequestListItem,
  toDeniedBookingRequestDecision,
} from './dto/booking-request-response.dto';

export type AcceptBookingRequestInput = {
  priceSource: BookingRequestPriceSource;
  customTotal?: string;
  customReason?: string;
};

export type { AuditActor } from '../../common/audit/audit-actor';

export type BookingRequestAcknowledgement = {
  requestId: string;
  status: 'pending';
  message: string;
};

type PublicRequestConfig = Awaited<
  ReturnType<BookingEngineConfigService['getPublicConfig']>
>;

type CardSnapshot = {
  setupIntentId: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  cardLastFour: string | null;
  cardBrand: string | null;
  consentText: string | null;
  consentVersion: string | null;
  consentedAt: Date | null;
};

type BookingRequestDatabase = PostgresJsDatabase;

type ExistingRequest = {
  id: string;
  propertyId: string;
  submissionIdempotencyKey: string;
  submissionFingerprint: string;
};

type LockedRequestConfig = typeof bookingEngineConfig.$inferSelect;
type CreatedConsequence = typeof bookingRequestConsequences.$inferSelect;

const ACKNOWLEDGEMENT_MESSAGE =
  'Your booking request has been received and is pending review.';
const CREATED_CONSEQUENCE_KIND = 'created_event' as const;
const ACCEPTED_CONSEQUENCE_KIND = 'accepted_event' as const;
const DENIED_CONSEQUENCE_KIND = 'denied_event' as const;
const RESERVATION_CREATED_CONSEQUENCE_KIND = 'reservation_created_event' as const;
const FOLIO_CREATED_CONSEQUENCE_KIND = 'folio_created_event' as const;
const CONSEQUENCE_CLAIM_LEASE_MS = 5 * 60 * 1000;

@Injectable()
export class BookingRequestService {
  private readonly logger = new Logger(BookingRequestService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: BookingRequestDatabase,
    @Inject(BookingEngineConfigService)
    private readonly configService: BookingEngineConfigService,
    @Inject(BookingEngineService)
    private readonly bookingEngineService: BookingEngineService,
    @Inject(AvailabilityService)
    private readonly availabilityService: AvailabilityService,
    @Inject(RatePlanService)
    private readonly ratePlanService: RatePlanService,
    @Inject(SAVED_PAYMENT_METHOD_GATEWAY)
    private readonly savedPaymentMethodGateway: SavedPaymentMethodGateway,
    @Inject(WebhookService) private readonly webhookService: WebhookService,
    @Inject(GuestService) private readonly guestService: GuestService,
    @Inject(ReservationService)
    private readonly reservationService: ReservationService,
    @Inject(FolioService) private readonly folioService: FolioService,
    @Inject(AncillaryService) private readonly ancillaryService: AncillaryService,
  ) {}

  async list(dto: ListBookingRequestsDto) {
    const conditions = [eq(bookingRequests.propertyId, dto.propertyId)];
    if (dto.status) conditions.push(eq(bookingRequests.status, dto.status));
    if (dto.arrivalDateFrom) {
      conditions.push(gte(bookingRequests.arrivalDate, dto.arrivalDateFrom));
    }
    if (dto.arrivalDateTo) {
      conditions.push(lte(bookingRequests.arrivalDate, dto.arrivalDateTo));
    }
    if (dto.departureDateFrom) {
      conditions.push(gte(bookingRequests.departureDate, dto.departureDateFrom));
    }
    if (dto.departureDateTo) {
      conditions.push(lte(bookingRequests.departureDate, dto.departureDateTo));
    }
    const guestQuery = dto.guest?.trim();
    if (guestQuery) {
      conditions.push(or(
        ilike(bookingRequests.guestFirstName, `%${guestQuery}%`),
        ilike(bookingRequests.guestLastName, `%${guestQuery}%`),
        ilike(bookingRequests.guestEmail, `%${guestQuery}%`),
      )!);
    }
    if (dto.hasCard === true) {
      conditions.push(isNotNull(bookingRequests.stripePaymentMethodId));
    } else if (dto.hasCard === false) {
      conditions.push(isNull(bookingRequests.stripePaymentMethodId));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const where = and(...conditions);
    const [selected, countRows] = await Promise.all([
      this.db
        .select()
        .from(bookingRequests)
        .where(where)
        .orderBy(desc(bookingRequests.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(bookingRequests)
        .where(where),
    ]);
    // The SQL predicate is authoritative. The final check is deliberate
    // defense-in-depth for adapters/test doubles that return an over-broad rowset.
    const data = selected
      .filter((row) => row.propertyId === dto.propertyId)
      .map(toBookingRequestListItem);
    const total = Number(countRows[0]?.count ?? 0);
    return { data, total, page, limit, hasMore: offset + data.length < total };
  }

  async findById(id: string, propertyId: string) {
    return toBookingRequestDetail(await this.findRequest(this.db, id, propertyId));
  }

  /**
   * Recover durable consequences after an API process stops between the
   * decision commit and dispatch. Claims remain property-scoped and the
   * existing lease permits safe recovery of stale processing rows.
   */
  async processPendingConsequences(limit = 100): Promise<number> {
    const staleBefore = new Date(Date.now() - CONSEQUENCE_CLAIM_LEASE_MS);
    const candidates = await this.db
      .select()
      .from(bookingRequestConsequences)
      .where(or(
        eq(bookingRequestConsequences.status, 'pending'),
        and(
          eq(bookingRequestConsequences.status, 'processing'),
          lte(bookingRequestConsequences.claimedAt, staleBefore),
        ),
      ))
      .orderBy(bookingRequestConsequences.createdAt)
      .limit(Math.max(1, Math.min(limit, 500)));

    const recoverable = candidates.filter((candidate) =>
      candidate.status === 'pending'
      || (
        candidate.status === 'processing'
        && candidate.claimedAt != null
        && candidate.claimedAt.getTime() <= staleBefore.getTime()
      ));
    const requests = new Map<string, { requestId: string; propertyId: string }>();
    for (const candidate of recoverable) {
      const key = `${candidate.propertyId}:${candidate.bookingRequestId}`;
      requests.set(key, {
        requestId: candidate.bookingRequestId,
        propertyId: candidate.propertyId,
      });
    }
    for (const request of requests.values()) {
      await this.deliverConsequencesBestEffort(
        request.requestId,
        request.propertyId,
      );
    }
    return requests.size;
  }

  async accept(
    id: string,
    propertyId: string,
    input: AcceptBookingRequestInput | AcceptBookingRequestDto,
    actor?: AuditActor,
  ) {
    const initial = await this.findRequest(this.db, id, propertyId);
    if (initial.status === 'accepted') {
      const linked = await this.findLinkedReservation(this.db, initial, propertyId);
      await this.deliverConsequencesBestEffort(id, propertyId);
      return toAcceptedBookingRequestDecision(initial, linked);
    }
    if (initial.status === 'denied') {
      throw new ConflictException('Cannot accept a denied booking request');
    }

    const result = await this.db.transaction(async (tx) => {
      const locked = await this.lockRequest(tx, id, propertyId);
      if (locked.status === 'accepted') {
        return {
          reservation: await this.findLinkedReservation(tx, locked, propertyId),
          request: locked,
        };
      }
      if (locked.status === 'denied') {
        throw new ConflictException('Cannot accept a denied booking request');
      }

      assertBookingRequestTransition(locked.status, 'accepted');
      await this.reservationService.lockInventory(propertyId, locked.roomTypeId, tx);
      const currentQuote = await this.bookingEngineService.quote(propertyId, {
        roomTypeId: locked.roomTypeId,
        ratePlanId: locked.ratePlanId,
        checkIn: locked.arrivalDate,
        checkOut: locked.departureDate,
        adults: locked.adults,
        children: locked.children,
        serviceIds: locked.serviceIds,
      }, tx, { lockForUpdate: true });
      const pricing = buildAcceptedPricingSnapshot({
        source: input.priceSource,
        requestCurrencyCode: locked.currencyCode,
        submittedQuote: locked.submittedQuoteSnapshot,
        currentQuote,
        customTotal: input.customTotal,
        customReason: input.customReason,
      });
      const guest = await this.guestService.create({
        firstName: locked.guestFirstName,
        lastName: locked.guestLastName,
        email: locked.guestEmail,
        phone: locked.guestPhone ?? undefined,
      }, tx);
      const reservation = await this.reservationService.create({
        propertyId,
        guestId: guest.id,
        arrivalDate: locked.arrivalDate,
        departureDate: locked.departureDate,
        roomTypeId: locked.roomTypeId,
        ratePlanId: locked.ratePlanId,
        totalAmount: pricing.grandTotal,
        currencyCode: pricing.currencyCode,
        adults: locked.adults,
        children: locked.children,
        specialRequests: locked.specialRequests ?? undefined,
        source: 'direct',
        channelCode: 'booking_request',
      }, { acceptedPricingSnapshot: pricing }, tx);
      const folio = await this.folioService.createAutoFolio({
        id: reservation.id,
        propertyId,
        bookingId: reservation.bookingId,
        guestId: guest.id,
        currencyCode: pricing.currencyCode,
      }, tx);

      const attachedServices: Array<Record<string, unknown>> = [];
      for (const serviceId of new Set(locked.serviceIds ?? [])) {
        const acceptedService = pricing.services.find((service: AcceptedPricingSnapshot['services'][number]) =>
          service.serviceId === serviceId);
        if (!acceptedService) {
          throw new ConflictException(
            `Accepted quote has no pricing for selected service ${serviceId}`,
          );
        }
        attachedServices.push(await this.ancillaryService.attachToReservation(
          reservation.id,
          {
            propertyId,
            serviceId,
            sourceChannel: 'booking_engine',
            unitPrice: acceptedService.unitPrice,
            quantity: 1,
          },
          tx,
          {
            currencyCode: acceptedService.currencyCode,
            postingRule: acceptedService.postingRule,
            chargeType: acceptedService.chargeType,
          },
        ));
      }
      attachedServices.push(...await this.ancillaryService.ensurePackageComponents(
        reservation.id,
        propertyId,
        tx,
        {
          freezeUnquotedAtZero: true,
          currencyCode: pricing.currencyCode,
        },
      ));

      const linkedPayments = await tx
        .update(payments)
        .set({ folioId: folio.id, updatedAt: new Date() })
        .where(and(
          eq(payments.propertyId, propertyId),
          eq(payments.bookingRequestId, id),
        ))
        .returning({ id: payments.id });
      if (linkedPayments.length > 0) {
        await this.folioService.recalculateBalance(folio.id, propertyId, tx);
      }

      const decidedAt = new Date();
      const [updated] = await tx
        .update(bookingRequests)
        .set({
          status: 'accepted',
          currentQuoteSnapshot: structuredClone(currentQuote),
          acceptedPriceSource: pricing.source,
          acceptedTotal: pricing.grandTotal,
          customPriceReason: pricing.customReason,
          acceptedReservationId: reservation.id,
          acceptedFolioId: folio.id,
          decidedBy: actor?.userId ?? null,
          decidedAt,
          updatedAt: decidedAt,
        })
        .where(and(
          eq(bookingRequests.id, id),
          eq(bookingRequests.propertyId, propertyId),
          eq(bookingRequests.status, 'pending'),
        ))
        .returning();
      if (!updated) {
        throw new ConflictException('Booking request decision changed concurrently');
      }

      await this.insertConsequence(tx, propertyId, id, ACCEPTED_CONSEQUENCE_KIND, {
        event: 'booking_request.accepted',
        entityType: 'booking_request',
        entityId: id,
        propertyId,
        data: {
          requestId: id,
          reservationId: reservation.id,
          folioId: folio.id,
          priceSource: pricing.source,
          acceptedTotal: pricing.grandTotal,
        },
        timestamp: decidedAt.toISOString(),
      });
      await this.insertConsequence(
        tx,
        propertyId,
        id,
        RESERVATION_CREATED_CONSEQUENCE_KIND,
        {
          event: 'reservation.created',
          entityType: 'reservation',
          entityId: reservation.id,
          propertyId,
          data: {
            reservationId: reservation.id,
            arrivalDate: reservation.arrivalDate,
            departureDate: reservation.departureDate,
            roomTypeId: reservation.roomTypeId,
          },
          timestamp: decidedAt.toISOString(),
        },
      );
      await this.insertConsequence(tx, propertyId, id, FOLIO_CREATED_CONSEQUENCE_KIND, {
        event: 'folio.created',
        entityType: 'folio',
        entityId: folio.id,
        propertyId,
        data: { folioNumber: folio.folioNumber, type: folio.type },
        timestamp: decidedAt.toISOString(),
      });
      for (const attached of attachedServices) {
        if (typeof attached['id'] !== 'string') continue;
        if (typeof attached['serviceName'] !== 'string') {
          throw new ConflictException('Attached service is missing its event snapshot');
        }
        await this.insertConsequence(tx, propertyId, id, `service:${attached['id']}`, {
          event: 'reservation.service_attached',
          entityType: 'reservation_service',
          entityId: attached['id'],
          propertyId,
          data: reservationServiceAttachedPayload(
            attached as unknown as Parameters<
              typeof reservationServiceAttachedPayload
            >[0],
            attached['serviceName'],
          ),
          timestamp: decidedAt.toISOString(),
        });
      }
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'booking_request',
        entityId: id,
        ...actorFields(actor),
        previousValue: { status: 'pending' },
        newValue: {
          status: 'accepted',
          reservationId: reservation.id,
          folioId: folio.id,
          priceSource: pricing.source,
          acceptedTotal: pricing.grandTotal,
          customPriceReason: pricing.customReason,
        },
        description: 'Booking request accepted',
      });
      return { reservation, request: updated };
    }).catch((error: unknown) => this.throwAcceptanceError(error));

    await this.deliverConsequencesBestEffort(id, propertyId);
    return toAcceptedBookingRequestDecision(result.request, result.reservation);
  }

  async deny(
    id: string,
    propertyId: string,
    input: DenyBookingRequestDto,
    actor?: AuditActor,
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('A denial reason is required');

    const denied = await this.db.transaction(async (tx) => {
      const locked = await this.lockRequest(tx, id, propertyId);
      if (locked.status === 'denied') {
        return locked;
      }
      assertBookingRequestTransition(locked.status, 'denied');

      const movementRows = await tx
        .select()
        .from(payments)
        .where(and(
          eq(payments.propertyId, propertyId),
          eq(payments.bookingRequestId, id),
        ));
      const resolutionRows = await tx
        .select()
        .from(bookingRequestPaymentResolutions)
        .where(and(
          eq(bookingRequestPaymentResolutions.propertyId, propertyId),
          eq(bookingRequestPaymentResolutions.bookingRequestId, id),
        ));
      const scopedMovements = movementRows.filter((row) =>
        row.propertyId === propertyId
        && row.bookingRequestId === id
        && row.originalPaymentId == null);
      const scopedResolutions = resolutionRows.filter((row) =>
        row.propertyId === propertyId && row.bookingRequestId === id);
      assertDenialMoneyResolved(scopedMovements, scopedResolutions);

      const decidedAt = new Date();
      const [updated] = await tx
        .update(bookingRequests)
        .set({
          status: 'denied',
          denialReason: reason,
          decidedBy: actor?.userId ?? null,
          decidedAt,
          updatedAt: decidedAt,
        })
        .where(and(
          eq(bookingRequests.id, id),
          eq(bookingRequests.propertyId, propertyId),
          eq(bookingRequests.status, 'pending'),
        ))
        .returning();
      if (!updated) {
        throw new ConflictException('Booking request decision changed concurrently');
      }
      await this.insertConsequence(tx, propertyId, id, DENIED_CONSEQUENCE_KIND, {
        event: 'booking_request.denied',
        entityType: 'booking_request',
        entityId: id,
        propertyId,
        data: { requestId: id, status: 'denied' },
        timestamp: decidedAt.toISOString(),
      });
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'booking_request',
        entityId: id,
        ...actorFields(actor),
        previousValue: { status: 'pending' },
        newValue: { status: 'denied', denialReason: reason },
        description: 'Booking request denied',
      });
      return updated;
    });

    await this.deliverConsequencesBestEffort(id, propertyId);
    return toDeniedBookingRequestDecision(denied);
  }

  async createPaymentMethodSetup(
    propertyId: string,
    dto: CreateRequestCardSetupDto,
  ): Promise<{ setupIntentId: string; clientSecret: string }> {
    const config = await this.configService.getPublicConfig(propertyId);
    this.assertRequestMode(config);
    if (config.paymentMethodCollection === 'disabled') {
      throw new BadRequestException('Payment method collection is disabled for booking requests');
    }
    if (!config.stripePublishableKey?.trim()) {
      throw new BadRequestException('Payment method collection is unavailable for this property');
    }

    const applicationId = this.normalizeApplicationId(dto.idempotencyKey);
    const setup = await this.savedPaymentMethodGateway.createSetup(
      dto.guestEmail,
      `booking-request:${propertyId}:${applicationId}`,
      { propertyId, applicationId },
    );
    return {
      setupIntentId: setup.setupIntentId,
      clientSecret: setup.clientSecret,
    };
  }

  async submit(
    propertyId: string,
    dto: SubmitBookingRequestDto,
  ): Promise<BookingRequestAcknowledgement> {
    assertCanonicalStayDates(dto.checkIn, dto.checkOut);
    const applicationId = this.normalizeApplicationId(dto.idempotencyKey);
    const fingerprint = this.submissionFingerprint(propertyId, dto);
    const existing = await this.findExistingRequest(
      this.db,
      propertyId,
      applicationId,
    );
    if (existing) {
      const acknowledgement = this.acknowledgeReplay(existing, fingerprint);
      await this.deliverCreatedConsequenceBestEffort(existing.id, propertyId);
      return acknowledgement;
    }

    const config = await this.configService.getPublicConfig(propertyId);
    this.assertRequestMode(config);
    this.assertConfiguredOffer(config, dto.roomTypeId, dto.ratePlanId);

    const applicationAnswers = validateApplicationAnswers(
      config.formQuestions,
      dto.applicationAnswers,
    );
    this.assertCardPolicyInput(config.paymentMethodCollection, dto);

    await this.ratePlanService.assertSellable(
      propertyId,
      dto.ratePlanId,
      dto.checkIn,
      dto.checkOut,
    );
    await this.assertAvailable(propertyId, dto);

    const quote = await this.bookingEngineService.quote(propertyId, {
      roomTypeId: dto.roomTypeId,
      ratePlanId: dto.ratePlanId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      adults: dto.adults,
      children: dto.children,
      serviceIds: dto.serviceIds,
    });
    this.assertQuoteUsesConfigSnapshot(config, quote);
    const card = await this.resolveCard(
      config.paymentMethodCollection,
      dto,
      { propertyId, applicationId },
    );

    const result = await this.db.transaction(async (tx) => {
      const [lockedConfig] = await tx
        .select()
        .from(bookingEngineConfig)
        .where(eq(bookingEngineConfig.propertyId, propertyId))
        .for('update');
      if (!lockedConfig || !this.sameRequestConfig(config, lockedConfig)) {
        throw new ConflictException('Booking request configuration changed; retry submission');
      }

      const transactionReplay = await this.findExistingRequest(
        tx,
        propertyId,
        applicationId,
      );
      if (transactionReplay) {
        this.acknowledgeReplay(transactionReplay, fingerprint);
        return { requestId: transactionReplay.id };
      }

      const [request] = await tx
        .insert(bookingRequests)
        .values({
          propertyId,
          submissionIdempotencyKey: applicationId,
          submissionFingerprint: fingerprint,
          status: 'pending',
          arrivalDate: dto.checkIn,
          departureDate: dto.checkOut,
          roomTypeId: dto.roomTypeId,
          ratePlanId: dto.ratePlanId,
          adults: dto.adults,
          children: dto.children ?? 0,
          guestFirstName: dto.guestFirstName,
          guestLastName: dto.guestLastName,
          guestEmail: dto.guestEmail,
          guestPhone: dto.guestPhone ?? null,
          specialRequests: dto.specialRequests ?? null,
          serviceIds: structuredClone(dto.serviceIds ?? []),
          formSnapshot: structuredClone(config.formQuestions),
          applicationAnswers: structuredClone(applicationAnswers),
          submittedQuoteSnapshot: structuredClone(quote),
          currentQuoteSnapshot: null,
          currencyCode: quote.currencyCode,
          ...card,
        })
        .onConflictDoNothing()
        .returning({ id: bookingRequests.id });

      if (request) {
        const createdPayload = this.createdEventPayload(request.id, propertyId);
        await tx.insert(bookingRequestConsequences).values({
          propertyId,
          bookingRequestId: request.id,
          kind: CREATED_CONSEQUENCE_KIND,
          payload: structuredClone(createdPayload) as unknown as Record<
            string,
            unknown
          >,
          status: 'pending',
          attempts: 0,
        });
        await tx.insert(auditLogs).values({
          propertyId,
          action: 'create',
          entityType: 'booking_request',
          entityId: request.id,
          description: 'Webhook event: booking_request.created',
          newValue: structuredClone(createdPayload),
        });
        return { requestId: request.id };
      }

      const concurrent = await this.findExistingRequest(
        tx,
        propertyId,
        applicationId,
      );
      if (!concurrent) {
        throw new ConflictException('Payment method setup has already been used');
      }
      this.acknowledgeReplay(concurrent, fingerprint);
      return { requestId: concurrent.id };
    });

    await this.deliverCreatedConsequenceBestEffort(result.requestId, propertyId);
    return this.acknowledgement(result.requestId);
  }

  private assertRequestMode(config: PublicRequestConfig): void {
    if (!config.isEnabled) {
      throw new ForbiddenException('Direct booking is not enabled for this property');
    }
    if (config.bookingMode !== 'request') {
      throw new ForbiddenException('Booking requests are not enabled for this property');
    }
  }

  private assertConfiguredOffer(
    config: PublicRequestConfig,
    roomTypeId: string,
    ratePlanId: string,
  ): void {
    if (!config.sellableRoomTypeIds.includes(roomTypeId)) {
      throw new BadRequestException('This room type is not available for direct booking');
    }
    if (!config.sellableRatePlanIds.includes(ratePlanId)) {
      throw new BadRequestException('This rate is not available for direct booking');
    }
  }

  private assertCardPolicyInput(
    policy: PaymentMethodCollection,
    dto: SubmitBookingRequestDto,
  ): void {
    const hasSetup = Boolean(dto.setupIntentId?.trim());
    const hasConsentData = dto.consentAccepted !== undefined
      || dto.consentText !== undefined
      || dto.consentVersion !== undefined;

    if (policy === 'disabled') {
      if (hasSetup || hasConsentData) {
        throw new BadRequestException('Payment method collection is disabled for booking requests');
      }
      return;
    }

    if (!hasSetup) {
      if (policy === 'required') {
        throw new BadRequestException('A saved payment method is required for this booking request');
      }
      if (hasConsentData) {
        throw new BadRequestException('Card consent requires a saved payment method');
      }
      return;
    }

    if (
      dto.consentAccepted !== true
      || !dto.consentText?.trim()
      || !dto.consentVersion?.trim()
    ) {
      throw new BadRequestException(
        'Explicit versioned consent is required to save a payment method',
      );
    }
  }

  private async resolveCard(
    policy: PaymentMethodCollection,
    dto: SubmitBookingRequestDto,
    provenance: { propertyId: string; applicationId: string },
  ): Promise<CardSnapshot> {
    if (policy === 'disabled' || !dto.setupIntentId) {
      return this.emptyCardSnapshot();
    }

    let savedMethod: SavedPaymentMethod;
    try {
      savedMethod = await this.savedPaymentMethodGateway.resolveSetup(
        dto.setupIntentId,
        provenance,
      );
    } catch {
      throw new BadRequestException('Payment method setup is incomplete or invalid');
    }

    return {
      setupIntentId: savedMethod.setupIntentId,
      stripeCustomerId: savedMethod.customerId,
      stripePaymentMethodId: savedMethod.paymentMethodId,
      cardLastFour: savedMethod.cardLastFour,
      cardBrand: savedMethod.cardBrand,
      consentText: dto.consentText!.trim(),
      consentVersion: dto.consentVersion!.trim(),
      consentedAt: new Date(),
    };
  }

  private emptyCardSnapshot(): CardSnapshot {
    return {
      setupIntentId: null,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      cardLastFour: null,
      cardBrand: null,
      consentText: null,
      consentVersion: null,
      consentedAt: null,
    };
  }

  private async assertAvailable(
    propertyId: string,
    dto: Pick<SubmitBookingRequestDto, 'checkIn' | 'checkOut' | 'roomTypeId'>,
  ): Promise<void> {
    const availability = await this.availabilityService.searchAvailability(
      propertyId,
      dto.checkIn,
      dto.checkOut,
      dto.roomTypeId,
    );
    const byDate = new Map(
      availability
        .filter((row) => row.roomTypeId === dto.roomTypeId)
        .map((row) => [row.date, row.available]),
    );

    for (const date of this.stayDates(dto.checkIn, dto.checkOut)) {
      if ((byDate.get(date) ?? 0) <= 0) {
        throw new ConflictException(
          'No availability for the requested room type and dates; use the waitlist instead',
        );
      }
    }
  }

  private stayDates(checkIn: string, checkOut: string): string[] {
    const dates: string[] = [];
    const current = new Date(`${checkIn}T00:00:00.000Z`);
    const departure = new Date(`${checkOut}T00:00:00.000Z`);
    while (current < departure) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  private normalizeApplicationId(value: string): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 200) {
      throw new BadRequestException('A valid submission idempotency key is required');
    }
    return normalized;
  }

  private submissionFingerprint(
    propertyId: string,
    dto: SubmitBookingRequestDto,
  ): string {
    const payload = {
      propertyId,
      roomTypeId: dto.roomTypeId,
      ratePlanId: dto.ratePlanId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      guestFirstName: dto.guestFirstName,
      guestLastName: dto.guestLastName,
      guestEmail: dto.guestEmail,
      guestPhone: dto.guestPhone ?? null,
      adults: dto.adults,
      children: dto.children ?? 0,
      specialRequests: dto.specialRequests ?? null,
      serviceIds: dto.serviceIds ?? [],
      applicationAnswers: dto.applicationAnswers,
      setupIntentId: dto.setupIntentId?.trim() || null,
      consentAccepted: dto.consentAccepted ?? null,
      consentText: dto.consentText?.trim() || null,
      consentVersion: dto.consentVersion?.trim() || null,
    };
    return createHash('sha256').update(this.stableSerialize(payload)).digest('hex');
  }

  private stableSerialize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'undefined';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableSerialize(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableSerialize(record[key])}`)
      .join(',')}}`;
  }

  private async findRequest(
    db: any,
    id: string,
    propertyId: string,
  ): Promise<typeof bookingRequests.$inferSelect> {
    const candidates = await db
      .select()
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.id, id),
        eq(bookingRequests.propertyId, propertyId),
      ));
    const request = candidates.find((candidate: typeof bookingRequests.$inferSelect) =>
      candidate.id === id && candidate.propertyId === propertyId);
    if (!request) {
      throw new NotFoundException(`Booking request ${id} not found`);
    }
    return request;
  }

  private async lockRequest(
    tx: any,
    id: string,
    propertyId: string,
  ): Promise<typeof bookingRequests.$inferSelect> {
    const candidates = await tx
      .select()
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.id, id),
        eq(bookingRequests.propertyId, propertyId),
      ))
      .for('update');
    const request = candidates.find((candidate: typeof bookingRequests.$inferSelect) =>
      candidate.id === id && candidate.propertyId === propertyId);
    if (!request) {
      throw new NotFoundException(`Booking request ${id} not found`);
    }
    return request;
  }

  private async findLinkedReservation(
    db: any,
    request: Pick<
      typeof bookingRequests.$inferSelect,
      'id' | 'acceptedReservationId'
    >,
    propertyId: string,
  ): Promise<typeof reservations.$inferSelect> {
    if (!request.acceptedReservationId) {
      throw new ConflictException(
        `Accepted booking request ${request.id} has no linked reservation`,
      );
    }
    const candidates = await db
      .select()
      .from(reservations)
      .where(and(
        eq(reservations.id, request.acceptedReservationId),
        eq(reservations.propertyId, propertyId),
      ));
    const reservation = candidates.find((candidate: typeof reservations.$inferSelect) =>
      candidate.id === request.acceptedReservationId
      && candidate.propertyId === propertyId);
    if (!reservation) {
      throw new ConflictException(
        `Accepted booking request ${request.id} has no recoverable reservation`,
      );
    }
    return reservation;
  }

  private throwAcceptanceError(error: unknown): never {
    if (
      error instanceof BadRequestException
      && /availability/i.test(error.message)
    ) {
      throw new ConflictException(error.message);
    }
    throw error;
  }

  private async insertConsequence(
    tx: any,
    propertyId: string,
    requestId: string,
    kind: string,
    payload: WebhookPayload,
  ): Promise<void> {
    const persistedPayload = structuredClone(payload) as unknown as Record<
      string,
      unknown
    >;
    await tx.insert(bookingRequestConsequences).values({
      propertyId,
      bookingRequestId: requestId,
      kind: kind as CreatedConsequence['kind'],
      payload: persistedPayload,
      status: 'pending',
      attempts: 0,
    });
    await tx.insert(auditLogs).values({
      propertyId,
      action: 'create',
      entityType: payload.entityType,
      entityId: payload.entityId,
      description: `Webhook event: ${payload.event}`,
      newValue: persistedPayload,
    });
  }

  private async findExistingRequest(
    db: Pick<BookingRequestDatabase, 'select'>,
    propertyId: string,
    applicationId: string,
  ): Promise<ExistingRequest | undefined> {
    const candidates = await db
      .select({
        id: bookingRequests.id,
        propertyId: bookingRequests.propertyId,
        submissionIdempotencyKey: bookingRequests.submissionIdempotencyKey,
        submissionFingerprint: bookingRequests.submissionFingerprint,
      })
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.propertyId, propertyId),
        eq(bookingRequests.submissionIdempotencyKey, applicationId),
      ));
    return candidates.find((candidate) =>
      candidate.propertyId === propertyId
      && candidate.submissionIdempotencyKey === applicationId);
  }

  private acknowledgeReplay(
    existing: ExistingRequest,
    fingerprint: string,
  ): BookingRequestAcknowledgement {
    if (existing.submissionFingerprint !== fingerprint) {
      throw new ConflictException('Submission idempotency key was already used');
    }
    return this.acknowledgement(existing.id);
  }

  private acknowledgement(requestId: string): BookingRequestAcknowledgement {
    return {
      requestId,
      status: 'pending',
      message: ACKNOWLEDGEMENT_MESSAGE,
    };
  }

  private createdEventPayload(
    requestId: string,
    propertyId: string,
  ): WebhookPayload {
    return {
      event: 'booking_request.created',
      entityType: 'booking_request',
      entityId: requestId,
      propertyId,
      data: { requestId, status: 'pending' },
      timestamp: new Date().toISOString(),
    };
  }

  private async deliverCreatedConsequenceBestEffort(
    requestId: string,
    propertyId: string,
  ): Promise<void> {
    await this.deliverConsequencesBestEffort(requestId, propertyId);
  }

  private async deliverConsequencesBestEffort(
    requestId: string,
    propertyId: string,
  ): Promise<void> {
    try {
      const candidates = await this.db
        .select()
        .from(bookingRequestConsequences)
        .where(and(
          eq(bookingRequestConsequences.propertyId, propertyId),
          eq(bookingRequestConsequences.bookingRequestId, requestId),
        ));
      const pendingKinds = candidates
        .filter((candidate) =>
          candidate.propertyId === propertyId
          && candidate.bookingRequestId === requestId
          && candidate.status !== 'completed')
        .map((candidate) => candidate.kind);

      for (const kind of pendingKinds) {
        const consequence = await this.claimConsequence(requestId, propertyId, kind);
        if (!consequence) continue;

        try {
          await this.webhookService.dispatchPersisted(
            consequence.payload as unknown as WebhookPayload,
            consequence.id,
          );
        } catch (error: unknown) {
          await this.recordConsequenceFailure(consequence, error);
          this.logger.error(
            `Booking request ${requestId} was committed but consequence '${kind}' failed`,
            error instanceof Error ? error.stack : undefined,
          );
          continue;
        }

        const completedAt = new Date();
        await this.db
          .update(bookingRequestConsequences)
          .set({
            status: 'completed',
            claimedAt: null,
            lastError: null,
            completedAt,
            updatedAt: completedAt,
          })
          .where(and(
            eq(bookingRequestConsequences.id, consequence.id),
            eq(bookingRequestConsequences.propertyId, propertyId),
            eq(bookingRequestConsequences.status, 'processing'),
            eq(bookingRequestConsequences.claimedAt, consequence.claimedAt!),
          ));
      }
    } catch (error: unknown) {
      this.logger.error(
        `Booking request ${requestId} was committed but consequence state could not be updated`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async claimConsequence(
    requestId: string,
    propertyId: string,
    kind: string,
  ): Promise<CreatedConsequence | undefined> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bookingRequestConsequences)
        .where(and(
          eq(bookingRequestConsequences.propertyId, propertyId),
          eq(bookingRequestConsequences.bookingRequestId, requestId),
          eq(
            bookingRequestConsequences.kind,
            kind as CreatedConsequence['kind'],
          ),
        ))
        .for('update');
      const consequence = rows.find((candidate) =>
        candidate.propertyId === propertyId
        && candidate.bookingRequestId === requestId
        && candidate.kind === kind);

      if (!consequence || consequence.status === 'completed') return undefined;
      if (
        consequence.status === 'processing'
        && consequence.claimedAt
        && consequence.claimedAt.getTime() > Date.now() - CONSEQUENCE_CLAIM_LEASE_MS
      ) {
        return undefined;
      }

      const attemptedAt = new Date();
      const [claimed] = await tx
        .update(bookingRequestConsequences)
        .set({
          status: 'processing',
          attempts: consequence.attempts + 1,
          claimedAt: attemptedAt,
          lastAttemptAt: attemptedAt,
          lastError: null,
          updatedAt: attemptedAt,
        })
        .where(and(
          eq(bookingRequestConsequences.id, consequence.id),
          eq(bookingRequestConsequences.propertyId, propertyId),
        ))
        .returning();
      return claimed;
    });
  }

  private async recordConsequenceFailure(
    consequence: CreatedConsequence,
    error: unknown,
  ): Promise<void> {
    const failedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    await this.db
      .update(bookingRequestConsequences)
      .set({
        status: 'pending',
        claimedAt: null,
        lastError: message.slice(0, 2000),
        updatedAt: failedAt,
      })
      .where(and(
        eq(bookingRequestConsequences.id, consequence.id),
        eq(bookingRequestConsequences.propertyId, consequence.propertyId),
        eq(bookingRequestConsequences.status, 'processing'),
        eq(bookingRequestConsequences.claimedAt, consequence.claimedAt!),
      ));
  }

  private assertQuoteUsesConfigSnapshot(
    config: PublicRequestConfig,
    quote: { depositPolicy: unknown },
  ): void {
    if (this.stableSerialize(config.depositPolicy) !== this.stableSerialize(quote.depositPolicy)) {
      throw new ConflictException('Booking request configuration changed; retry submission');
    }
  }

  private sameRequestConfig(
    initial: PublicRequestConfig,
    locked: LockedRequestConfig,
  ): boolean {
    const lockedFormQuestions = validateQuestionDefinitions(
      (locked.formQuestions ?? []) as BookingFormQuestion[],
    )
      .filter((question) => question.isActive)
      .sort((a, b) => a.order - b.order);
    const initialSnapshot = {
      propertyId: initial.propertyId,
      isEnabled: initial.isEnabled,
      bookingMode: initial.bookingMode,
      paymentMethodCollection: initial.paymentMethodCollection,
      stripePublishableKey: initial.stripePublishableKey,
      sellableRoomTypeIds: initial.sellableRoomTypeIds,
      sellableRatePlanIds: initial.sellableRatePlanIds,
      depositPolicy: initial.depositPolicy,
      formQuestions: initial.formQuestions,
    };
    const lockedSnapshot = {
      propertyId: locked.propertyId,
      isEnabled: locked.isEnabled,
      bookingMode: locked.bookingMode,
      paymentMethodCollection: locked.paymentMethodCollection,
      stripePublishableKey: locked.stripePublishableKey,
      sellableRoomTypeIds: locked.sellableRoomTypeIds,
      sellableRatePlanIds: locked.sellableRatePlanIds,
      depositPolicy: locked.depositPolicy,
      formQuestions: lockedFormQuestions,
    };
    return this.stableSerialize(initialSnapshot) === this.stableSerialize(lockedSnapshot);
  }
}
