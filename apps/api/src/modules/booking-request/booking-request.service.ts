import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  auditLogs,
  bookingEngineConfig,
  bookingRequestConsequences,
  bookingRequests,
} from '@telivityhaip/database';
import type {
  BookingFormQuestion,
  PaymentMethodCollection,
} from '@telivityhaip/database';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
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
import { AvailabilityService } from '../reservation/availability.service';
import {
  WebhookService,
  type WebhookPayload,
} from '../webhook/webhook.service';
import { assertCanonicalStayDates } from './booking-request-date.validator';
import type { CreateRequestCardSetupDto } from './dto/create-request-card-setup.dto';
import type { SubmitBookingRequestDto } from './dto/submit-booking-request.dto';

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
  ) {}

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
    try {
      const consequence = await this.claimCreatedConsequence(requestId, propertyId);
      if (!consequence) return;

      try {
        await this.webhookService.dispatchPersisted(
          consequence.payload as unknown as WebhookPayload,
        );
      } catch (error: unknown) {
        await this.recordConsequenceFailure(consequence, error);
        this.logger.error(
          `Booking request ${requestId} was committed but its created consequence failed`,
          error instanceof Error ? error.stack : undefined,
        );
        return;
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
    } catch (error: unknown) {
      this.logger.error(
        `Booking request ${requestId} was committed but its created consequence state could not be updated`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async claimCreatedConsequence(
    requestId: string,
    propertyId: string,
  ): Promise<CreatedConsequence | undefined> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bookingRequestConsequences)
        .where(and(
          eq(bookingRequestConsequences.propertyId, propertyId),
          eq(bookingRequestConsequences.bookingRequestId, requestId),
          eq(bookingRequestConsequences.kind, CREATED_CONSEQUENCE_KIND),
        ))
        .for('update');
      const consequence = rows.find((candidate) =>
        candidate.propertyId === propertyId
        && candidate.bookingRequestId === requestId
        && candidate.kind === CREATED_CONSEQUENCE_KIND);

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
