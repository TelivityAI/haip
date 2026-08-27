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
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  bookingRequestStayAmendments,
  bookingRequests,
  payments,
  properties,
  reservationServices,
  reservations,
} from './booking-request-db.js';
import type {
  AcceptedPricingSnapshot,
  PaymentMethodCollection,
} from './booking-request-db.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  BookingRequestAcceptedWebhook,
  BookingRequestCreatedWebhook,
  BookingRequestDeniedWebhook,
} from '@telivityhaip/shared';
import {
  actorFields,
  type AuditActor,
} from '@telivityhaip/shared';
import { matchAcceptedReservationServiceRows } from './accepted-reservation-service.js';
import { withAcceptedPricingLock } from './accepted-pricing-lock.js';
import { DRIZZLE } from '@telivityhaip/database';
import { reservationServiceAttachedPayload } from './reservation-service-event.js';
import {
  isSupportedQuestion,
  validateApplicationAnswers,
  validateQuestionDefinitions,
} from './booking-form-questions.js';
import {
  SAVED_PAYMENT_METHOD_GATEWAY,
  type SavedPaymentMethod,
  type SavedPaymentMethodGateway,
  type WebhookEvent,
} from '@telivityhaip/shared';
import {
  AncillaryServicePort,
  AvailabilityServicePort,
  BookingEngineConfigServicePort,
  BookingEngineServicePort,
  FolioServicePort,
  GuestServicePort,
  RatePlanServicePort,
  ReservationServicePort,
  WebhookServicePort,
} from '../module/ports.js';
/** Trimmed local twin of apps/api's `WebhookPayload` (see `WebhookServicePort`). */
type WebhookPayload = {
  event: WebhookEvent;
  entityType: string;
  entityId: string;
  propertyId?: string;
  data: Record<string, unknown>;
  timestamp: string;
  logicalEventId?: string;
};
import { assertCanonicalStayDates } from './booking-request-date.validator.js';
import {
  assertLedgerCurrencySupported,
  type BookingRequestPriceSource,
} from './booking-request-money.js';
import { summarizeBookingRequestPaymentLedger } from './booking-request-payment-ledger.js';
import { assertBookingRequestTransition } from './booking-request-state.js';
import { buildAcceptedPricingSnapshot } from './booking-request-pricing.js';
import {
  buildAmendedPricingSnapshot,
  buildPriorAmendedPricingSnapshot,
  withoutCancelledAcceptedServices,
  type StayAmendmentPriceSource,
} from './booking-request-amendment-pricing.js';
import {
  acceptedBookingRequestEmail,
  deniedBookingRequestEmail,
  requestReceivedEmail,
} from './booking-request-email.templates.js';
import { BookingRequestMailerService } from './booking-request-mailer.service.js';
import type { AcceptBookingRequestDto } from '../http/dto/accept-booking-request.dto.js';
import type { CreateRequestCardSetupDto } from '../http/dto/create-request-card-setup.dto.js';
import type { DenyBookingRequestDto } from '../http/dto/deny-booking-request.dto.js';
import type { ListBookingRequestsDto } from '../http/dto/list-booking-requests.dto.js';
import type { SubmitBookingRequestDto } from '../http/dto/submit-booking-request.dto.js';
import type {
  AmendBookingRequestStayDto,
  PreviewBookingRequestStayAmendmentDto,
} from '../http/dto/amend-booking-request-stay.dto.js';
import {
  toAcceptedBookingRequestDecision,
  toBookingRequestDetail,
  toBookingRequestListItem,
  toDeniedBookingRequestDecision,
  toBookingRequestAuditHistoryItem,
} from '../http/dto/booking-request-response.dto.js';

type BookingRequestAuditCursor = {
  timelineSequence: string;
};

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

function encodeBookingRequestAuditCursor(
  row: Pick<typeof auditLogs.$inferSelect, 'timelineSequence'>,
): string {
  const cursor: BookingRequestAuditCursor = {
    timelineSequence: row.timelineSequence.toString(),
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeBookingRequestAuditCursor(value: string | undefined): BookingRequestAuditCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<BookingRequestAuditCursor>;
    const timelineSequence = parsed.timelineSequence;
    const timelineSequenceValue = typeof timelineSequence === 'string'
      && /^[1-9]\d{0,18}$/.test(timelineSequence)
      ? BigInt(timelineSequence)
      : null;
    if (
      Object.keys(parsed).length !== 1
      || typeof timelineSequence !== 'string'
      || timelineSequenceValue == null
      || timelineSequenceValue > POSTGRES_BIGINT_MAX
    ) throw new Error('invalid cursor');
    return { timelineSequence };
  } catch {
    throw new BadRequestException('Invalid booking request audit cursor');
  }
}

function auditRowPrecedesCursor(
  row: Pick<typeof auditLogs.$inferSelect, 'timelineSequence'>,
  cursor: BookingRequestAuditCursor | null,
): boolean {
  if (!cursor) return true;
  return row.timelineSequence < BigInt(cursor.timelineSequence);
}

export type AcceptBookingRequestInput = {
  priceSource: BookingRequestPriceSource;
  previewToken: string;
  customTotal?: string;
  customReason?: string;
};

type AcceptancePreviewFingerprintInput = {
  requestId: string;
  propertyId: string;
  requestUpdatedAt: Date;
  currencyCode: string;
  currentTotal: string;
};

export function acceptancePreviewFingerprint(
  input: AcceptancePreviewFingerprintInput,
): string {
  const serialized = JSON.stringify({
    version: 1,
    requestId: input.requestId,
    propertyId: input.propertyId,
    requestUpdatedAt: input.requestUpdatedAt.toISOString(),
    currencyCode: input.currencyCode,
    currentTotal: input.currentTotal,
  });
  return `v1:${createHash('sha256').update(serialized).digest('hex')}`;
}

type AmendmentPreviewFingerprintInput = {
  requestId: string;
  propertyId: string;
  reservationId: string;
  reservationUpdatedAt: Date;
  previousArrivalDate: string;
  previousDepartureDate: string;
  previousTotal: string;
  previousPricing: AcceptedPricingSnapshot;
  arrivalDate: string;
  departureDate: string;
  currentQuote: unknown;
};

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

export function amendmentPreviewFingerprint(
  input: AmendmentPreviewFingerprintInput,
): string {
  const serialized = stableSerialize({ version: 1, ...input });
  return `v1:${createHash('sha256').update(serialized).digest('hex')}`;
}

export type StayAmendmentResult = {
  amendmentId: string;
  requestId: string;
  reservationId: string;
  folioId: string;
  previousArrivalDate: string;
  previousDepartureDate: string;
  arrivalDate: string;
  departureDate: string;
  previousTotalAmount: string;
  newTotalAmount: string;
  currencyCode: string;
  priceSource: StayAmendmentPriceSource;
  reason: string | null;
};

export type { AuditActor } from '@telivityhaip/shared';

export type BookingRequestAcknowledgement = {
  requestId: string;
  status: 'pending';
  message: string;
};

type PublicRequestConfig = Awaited<
  ReturnType<BookingEngineConfigServicePort['getPublicConfig']>
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

type CreatedConsequence = typeof bookingRequestConsequences.$inferSelect;
type EmailQueueExecutor = NonNullable<Parameters<BookingRequestMailerService['queue']>[1]>;

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
    @Inject(BookingEngineConfigServicePort)
    private readonly configService: BookingEngineConfigServicePort,
    @Inject(BookingEngineServicePort)
    private readonly bookingEngineService: BookingEngineServicePort,
    @Inject(AvailabilityServicePort)
    private readonly availabilityService: AvailabilityServicePort,
    @Inject(RatePlanServicePort)
    private readonly ratePlanService: RatePlanServicePort,
    @Inject(SAVED_PAYMENT_METHOD_GATEWAY)
    private readonly savedPaymentMethodGateway: SavedPaymentMethodGateway,
    @Inject(WebhookServicePort) private readonly webhookService: WebhookServicePort,
    @Inject(GuestServicePort) private readonly guestService: GuestServicePort,
    @Inject(ReservationServicePort)
    private readonly reservationService: ReservationServicePort,
    @Inject(FolioServicePort) private readonly folioService: FolioServicePort,
    @Inject(AncillaryServicePort) private readonly ancillaryService: AncillaryServicePort,
    @Inject(BookingRequestMailerService)
    private readonly mailer: BookingRequestMailerService,
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
    const direction = dto.sortOrder === 'asc' ? asc : desc;
    const orderBy = dto.sortBy === 'requestedTotal'
      ? [direction(bookingRequests.submittedTotal), direction(bookingRequests.id)]
      : dto.sortBy === 'arrivalDate'
        ? [direction(bookingRequests.arrivalDate), direction(bookingRequests.id)]
        : dto.sortBy === 'guestName'
          ? [
            direction(bookingRequests.guestLastName),
            direction(bookingRequests.guestFirstName),
            direction(bookingRequests.id),
          ]
          : dto.sortBy === 'status'
            ? [direction(bookingRequests.status), direction(bookingRequests.id)]
            : [direction(bookingRequests.createdAt), direction(bookingRequests.id)];
    const [selected, countRows] = await Promise.all([
      this.db
        .select()
        .from(bookingRequests)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
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
    const request = await this.findRequest(this.db, id, propertyId);
    const operationalReservation = request.status === 'accepted'
      ? await this.findLinkedReservation(this.db, request, propertyId)
      : null;
    return toBookingRequestDetail(request, operationalReservation);
  }

  async auditHistory(
    id: string,
    propertyId: string,
    pagination: { limit?: number; cursor?: string } = {},
  ) {
    await this.findRequest(this.db, id, propertyId);
    const [installments, allocations, paymentRows, resolutions, emails] = await Promise.all([
      this.db.select({ id: bookingRequestInstallments.id })
        .from(bookingRequestInstallments)
        .where(and(
          eq(bookingRequestInstallments.propertyId, propertyId),
          eq(bookingRequestInstallments.bookingRequestId, id),
        )),
      this.db.select({ id: bookingRequestPaymentAllocations.id })
        .from(bookingRequestPaymentAllocations)
        .where(and(
          eq(bookingRequestPaymentAllocations.propertyId, propertyId),
          eq(bookingRequestPaymentAllocations.bookingRequestId, id),
        )),
      this.db.select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.propertyId, propertyId), eq(payments.bookingRequestId, id))),
      this.db.select({ id: bookingRequestPaymentResolutions.id })
        .from(bookingRequestPaymentResolutions)
        .where(and(
          eq(bookingRequestPaymentResolutions.propertyId, propertyId),
          eq(bookingRequestPaymentResolutions.bookingRequestId, id),
        )),
      this.db.select({ id: bookingRequestEmailDeliveries.id })
        .from(bookingRequestEmailDeliveries)
        .where(and(
          eq(bookingRequestEmailDeliveries.propertyId, propertyId),
          eq(bookingRequestEmailDeliveries.bookingRequestId, id),
        )),
    ]);
    const entityConditions = [
      eq(auditLogs.bookingRequestId, id),
      and(eq(auditLogs.entityType, 'booking_request'), eq(auditLogs.entityId, id)),
      ...(installments.length ? [and(
        eq(auditLogs.entityType, 'booking_request_installment'),
        inArray(auditLogs.entityId, installments.map((row) => row.id)),
      )] : []),
      ...(allocations.length ? [and(
        eq(auditLogs.entityType, 'booking_request_payment_allocation'),
        inArray(auditLogs.entityId, allocations.map((row) => row.id)),
      )] : []),
      ...(paymentRows.length ? [and(
        eq(auditLogs.entityType, 'payment'),
        inArray(auditLogs.entityId, paymentRows.map((row) => row.id)),
      )] : []),
      ...(resolutions.length ? [and(
        eq(auditLogs.entityType, 'booking_request_payment_resolution'),
        inArray(auditLogs.entityId, resolutions.map((row) => row.id)),
      )] : []),
      ...(emails.length ? [and(
        eq(auditLogs.entityType, 'booking_request_email_delivery'),
        inArray(auditLogs.entityId, emails.map((row) => row.id)),
      )] : []),
    ].filter((condition): condition is NonNullable<typeof condition> => condition != null);
    const allowedEntityTypes = [
      'booking_request',
      'booking_request_installment',
      'booking_request_payment_allocation',
      'payment',
      'booking_request_payment_resolution',
      'booking_request_email_delivery',
      'reservation',
    ];
    const limit = Math.max(1, Math.min(pagination.limit ?? 50, 100));
    const cursor = decodeBookingRequestAuditCursor(pagination.cursor);
    const selected = await this.db
      .select()
      .from(auditLogs)
      .where(and(
        eq(auditLogs.propertyId, propertyId),
        inArray(auditLogs.entityType, allowedEntityTypes),
        or(...entityConditions),
        cursor
          ? lt(auditLogs.timelineSequence, BigInt(cursor.timelineSequence))
          : undefined,
      ))
      .orderBy(desc(auditLogs.timelineSequence))
      .limit(limit + 1);
    const rows = selected.filter((row) => row.propertyId === propertyId);
    const relatedEntities = new Set<string>([
      `booking_request:${id}`,
      ...installments.map((row) => `booking_request_installment:${row.id}`),
      ...allocations.map((row) => `booking_request_payment_allocation:${row.id}`),
      ...paymentRows.map((row) => `payment:${row.id}`),
      ...resolutions.map((row) => `booking_request_payment_resolution:${row.id}`),
      ...emails.map((row) => `booking_request_email_delivery:${row.id}`),
    ]);
    const allowedEntityTypeSet = new Set(allowedEntityTypes);
    const pageRows = rows
      .filter((row) => allowedEntityTypeSet.has(row.entityType)
        && (
          row.bookingRequestId === id
          || relatedEntities.has(`${row.entityType}:${row.entityId ?? ''}`)
        )
        && auditRowPrecedesCursor(row, cursor))
      .sort((left, right) => {
        return right.timelineSequence === left.timelineSequence
          ? 0
          : right.timelineSequence > left.timelineSequence ? 1 : -1;
      });
    const data = pageRows.slice(0, limit).map(toBookingRequestAuditHistoryItem);
    return {
      data,
      nextCursor: pageRows.length > limit
        ? encodeBookingRequestAuditCursor(pageRows[limit - 1]!)
        : null,
    };
  }

  async acceptancePreview(id: string, propertyId: string) {
    const request = await this.findRequest(this.db, id, propertyId);
    if (request.status !== 'pending') {
      throw new ConflictException('Only pending booking requests can be previewed');
    }
    const currentQuote = await this.bookingEngineService.quote(propertyId, {
      roomTypeId: request.roomTypeId,
      ratePlanId: request.ratePlanId,
      checkIn: request.arrivalDate,
      checkOut: request.departureDate,
      adults: request.adults,
      children: request.children,
      serviceIds: request.serviceIds,
    });
    const submittedQuote = request.submittedQuoteSnapshot as Record<string, unknown>;
    const submittedTotal = submittedQuote['grandTotal'];
    if (typeof submittedTotal !== 'string' && typeof submittedTotal !== 'number') {
      throw new ConflictException('Submitted quote total is unavailable');
    }
    if (currentQuote.currencyCode !== request.currencyCode) {
      throw new ConflictException('Current quote currency does not match the request');
    }
    const currentTotal = String(currentQuote.grandTotal);
    return {
      requestId: request.id,
      submittedTotal: String(submittedTotal),
      currentTotal,
      currencyCode: request.currencyCode,
      previewVersion: 1 as const,
      previewToken: acceptancePreviewFingerprint({
        requestId: request.id,
        propertyId: request.propertyId,
        requestUpdatedAt: request.updatedAt,
        currencyCode: request.currencyCode,
        currentTotal,
      }),
    };
  }

  async stayAmendmentPreview(
    id: string,
    propertyId: string,
    dates: PreviewBookingRequestStayAmendmentDto,
  ) {
    assertCanonicalStayDates(dates.arrivalDate, dates.departureDate);
    const request = await this.findRequest(this.db, id, propertyId);
    this.assertAcceptedStayAmendmentRequest(request);
    const reservation = await this.findLinkedReservation(this.db, request, propertyId);
    const preview = await this.buildStayAmendmentPreview(
      request,
      reservation,
      dates,
      this.db,
      false,
    ).catch((error: unknown) => this.throwStayAmendmentError(error));
    const { operationalPreviousPricing: _operationalPreviousPricing, ...response } = preview;
    return response;
  }

  async amendStay(
    id: string,
    propertyId: string,
    input: AmendBookingRequestStayDto,
    actor?: AuditActor,
  ): Promise<StayAmendmentResult> {
    assertCanonicalStayDates(input.arrivalDate, input.departureDate);
    const idempotencyKey = this.normalizeStayAmendmentIdempotencyKey(input.idempotencyKey);
    const reason = input.priceSource === 'custom' ? input.customReason?.trim() : null;
    if (input.priceSource === 'custom' && !reason) {
      throw new BadRequestException('A reason is required for a custom amended price');
    }
    const operationFingerprint = this.stayAmendmentOperationFingerprint(
      id,
      propertyId,
      { ...input, idempotencyKey },
    );

    const transactionResult = await this.db.transaction(async (tx) => {
      // Resolve the immutable accepted reservation link without taking a row
      // lock, then acquire the shared pricing/posting mutex first. A poster
      // holding that mutex may still need FK key-share locks on property and
      // request rows while inserting its charge. Taking those UPDATE locks
      // before waiting here would form a real posting-first deadlock.
      const requestCandidate = await this.findRequest(tx, id, propertyId);
      this.assertAcceptedStayAmendmentRequest(requestCandidate);
      return withAcceptedPricingLock(
        this.db,
        propertyId,
        requestCandidate.acceptedReservationId!,
        async () => {
      await this.lockProperty(tx, propertyId);
      const request = await this.lockRequest(tx, id, propertyId);
      this.assertAcceptedStayAmendmentRequest(request);
      if (request.acceptedReservationId !== requestCandidate.acceptedReservationId) {
        throw new ConflictException('Accepted reservation link changed; retry the amendment');
      }
      const reservation = await this.lockLinkedReservation(tx, request, propertyId);

      const replay = await this.findExistingStayAmendment(
        tx,
        propertyId,
        id,
        idempotencyKey,
        operationFingerprint,
      );
      if (replay) return { result: this.toStayAmendmentResult(replay), replay: true };

      await this.reservationService.lockInventory(propertyId, reservation.roomTypeId, tx);
      const preview = await this.buildStayAmendmentPreview(
        request,
        reservation,
        input,
        tx,
        true,
      );
      if (input.previewToken !== preview.previewToken) {
        throw new ConflictException(
          'Stay amendment preview changed; refresh the quote before applying it',
        );
      }
      const previousPricing = reservation.acceptedPricingSnapshot as AcceptedPricingSnapshot;
      const newPricing = buildAmendedPricingSnapshot({
        source: input.priceSource,
        previous: preview.operationalPreviousPricing,
        currentQuote: preview.currentQuote,
        currencyCode: reservation.currencyCode,
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        customTotal: input.customTotal,
        customReason: reason ?? undefined,
      });
      const amendmentId = randomUUID();
      const folioReconciliation = await this.folioService.reconcileAcceptedStayAmendment({
        tx,
        amendmentId,
        propertyId,
        folioId: request.acceptedFolioId!,
        reservationId: reservation.id,
        previousPricing,
        newPricing,
        postedBy: actor?.userId ?? null,
      });
      const amended = await this.reservationService.modifyAcceptedStay(
        reservation,
        propertyId,
        {
          arrivalDate: input.arrivalDate,
          departureDate: input.departureDate,
          totalAmount: newPricing.grandTotal,
        },
        newPricing,
        tx,
      );
      const createdAt = new Date();
      const amendmentValues = {
        id: amendmentId,
        propertyId,
        bookingRequestId: id,
        reservationId: reservation.id,
        folioId: request.acceptedFolioId!,
        idempotencyKey,
        operationFingerprint,
        previewToken: input.previewToken,
        priceSource: input.priceSource,
        previousArrivalDate: reservation.arrivalDate,
        previousDepartureDate: reservation.departureDate,
        newArrivalDate: input.arrivalDate,
        newDepartureDate: input.departureDate,
        previousTotalAmount: reservation.totalAmount,
        newTotalAmount: newPricing.grandTotal,
        currencyCode: reservation.currencyCode,
        reason: reason ?? null,
        previousPricingSnapshot: structuredClone(previousPricing),
        newPricingSnapshot: structuredClone(newPricing),
        actorUserId: actor?.userId ?? null,
        actorEmail: actor?.userEmail ?? null,
        createdAt,
      };
      await tx.insert(bookingRequestStayAmendments).values(amendmentValues);
      await tx.insert(auditLogs).values({
        propertyId,
        bookingRequestId: id,
        action: 'update',
        entityType: 'reservation',
        entityId: reservation.id,
        ...actorFields(actor),
        previousValue: {
          arrivalDate: reservation.arrivalDate,
          departureDate: reservation.departureDate,
          totalAmount: reservation.totalAmount,
          acceptedPricingSnapshot: structuredClone(previousPricing),
        },
        newValue: {
          amendmentId,
          previousArrivalDate: reservation.arrivalDate,
          previousDepartureDate: reservation.departureDate,
          previousTotalAmount: reservation.totalAmount,
          previousPriceSource: previousPricing.source,
          arrivalDate: amended.reservation.arrivalDate,
          departureDate: amended.reservation.departureDate,
          totalAmount: amended.reservation.totalAmount,
          priceSource: input.priceSource,
          reason: reason ?? null,
          acceptedPricingSnapshot: structuredClone(newPricing),
          folioReconciliation: structuredClone(folioReconciliation),
        },
        description: 'Accepted Booking Request stay amended',
      });
      await this.insertConsequence(tx, propertyId, id, `amend:${amendmentId}`, {
        event: 'reservation.modified',
        entityType: 'reservation',
        entityId: reservation.id,
        propertyId,
        data: {
          amendmentId,
          bookingRequestId: id,
          reservationId: reservation.id,
          folioId: request.acceptedFolioId!,
          previousArrivalDate: reservation.arrivalDate,
          previousDepartureDate: reservation.departureDate,
          arrivalDate: amended.reservation.arrivalDate,
          departureDate: amended.reservation.departureDate,
          roomTypeId: reservation.roomTypeId,
          previousTotalAmount: reservation.totalAmount,
          totalAmount: amended.reservation.totalAmount,
          currencyCode: reservation.currencyCode,
          priceSource: input.priceSource,
          reason: reason ?? null,
        },
        timestamp: createdAt.toISOString(),
      }, { audit: false });
      return {
        result: this.toStayAmendmentResult(amendmentValues),
        replay: false,
      };
        },
        tx,
      );
    }).catch((error: unknown) => this.throwStayAmendmentError(error));

    await this.deliverConsequencesBestEffort(id, propertyId);
    return transactionResult.result;
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
      await this.queueAcceptedEmailBestEffort(initial, propertyId);
      await this.deliverConsequencesBestEffort(id, propertyId);
      await this.deliverEmailsBestEffort(id, propertyId);
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
      // Acceptance sources are narrower than the operational snapshot's later
      // amendment-only `prior` source.
      const acceptancePriceSource = pricing.source as BookingRequestPriceSource;
      const expectedPreviewToken = acceptancePreviewFingerprint({
        requestId: locked.id,
        propertyId: locked.propertyId,
        requestUpdatedAt: locked.updatedAt,
        currencyCode: currentQuote.currencyCode,
        currentTotal: String(currentQuote.grandTotal),
      });
      if (input.previewToken !== expectedPreviewToken) {
        throw new ConflictException(
          'Acceptance preview changed; refresh the quote before accepting',
        );
      }
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
          acceptedPriceSource: acceptancePriceSource,
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

      const acceptedEvent = {
        event: 'booking_request.accepted',
        entityType: 'booking_request',
        entityId: id,
        propertyId,
        data: {
          requestId: id,
          reservationId: reservation.id,
          folioId: folio.id,
          priceSource: acceptancePriceSource,
          acceptedTotal: pricing.grandTotal,
          currencyCode: locked.currencyCode,
        },
        timestamp: decidedAt.toISOString(),
      } satisfies BookingRequestAcceptedWebhook;
      await this.insertConsequence(
        tx,
        propertyId,
        id,
        ACCEPTED_CONSEQUENCE_KIND,
        acceptedEvent,
      );
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
        bookingRequestId: id,
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
      await this.queueAcceptedEmail(updated, tx);
      return { reservation, request: updated };
    }).catch((error: unknown) => this.throwAcceptanceError(error));

    await this.deliverConsequencesBestEffort(id, propertyId);
    await this.deliverEmailsBestEffort(id, propertyId);
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
        return { request: locked, replay: true };
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
        row.propertyId === propertyId && row.bookingRequestId === id);
      const parentMovements = scopedMovements.filter((row) => row.originalPaymentId == null);
      if (parentMovements.some((row) => row.status === 'pending')) {
        throw new ConflictException(
          'Booking request has a pending payment attempt; retry or resolve it before denial',
        );
      }
      const scopedResolutions = resolutionRows.filter((row) =>
        row.propertyId === propertyId && row.bookingRequestId === id);
      if (scopedResolutions.some((row) => row.status === 'pending')) {
        throw new ConflictException(
          'Booking request has a pending payment resolution; retry it before denial',
        );
      }
      const parentIds = new Set(parentMovements.map((row) => row.id));
      for (const resolution of scopedResolutions) {
        if (!parentIds.has(resolution.paymentId)) {
          throw new ConflictException(
            `Resolution references unknown captured movement '${resolution.paymentId}'`,
          );
        }
        if (resolution.type === 'retained' && !resolution.reason?.trim()) {
          throw new ConflictException('A reason is required for retained money');
        }
      }
      for (const payment of parentMovements) {
        const summary = summarizeBookingRequestPaymentLedger(
          payment,
          scopedMovements,
          [],
          scopedResolutions,
        );
        if (summary.unresolved.gt(0)) {
          throw new ConflictException(
            `Captured movement '${payment.id}' has unresolved money: ${summary.unresolved.toFixed(2)} remains`,
          );
        }
      }

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
      const deniedEvent = {
        event: 'booking_request.denied',
        entityType: 'booking_request',
        entityId: id,
        propertyId,
        data: { requestId: id, status: 'denied' },
        timestamp: decidedAt.toISOString(),
      } satisfies BookingRequestDeniedWebhook;
      await this.insertConsequence(
        tx,
        propertyId,
        id,
        DENIED_CONSEQUENCE_KIND,
        deniedEvent,
      );
      await tx.insert(auditLogs).values({
        propertyId,
        bookingRequestId: id,
        action: 'update',
        entityType: 'booking_request',
        entityId: id,
        ...actorFields(actor),
        previousValue: { status: 'pending' },
        newValue: { status: 'denied', denialReason: reason },
        description: 'Booking request denied',
      });
      await this.queueDeniedEmail(updated, tx);
      return { request: updated, replay: false };
    });

    if (denied.replay) {
      await this.queueDeniedEmailBestEffort(denied.request, propertyId);
    }
    await this.deliverConsequencesBestEffort(id, propertyId);
    await this.deliverEmailsBestEffort(id, propertyId);
    return toDeniedBookingRequestDecision(denied.request);
  }

  async createPaymentMethodSetup(
    propertyId: string,
    dto: CreateRequestCardSetupDto,
  ): Promise<{
    setupIntentId: string;
    clientSecret: string;
    clientMode: 'mock' | 'stripe';
  }> {
    const config = await this.configService.getPublicConfig(propertyId);
    this.assertRequestMode(config);
    if (config.paymentMethodCollection === 'disabled') {
      throw new BadRequestException('Payment method collection is disabled for booking requests');
    }
    this.assertCardCollectionCapability(config, true);

    const applicationId = this.normalizeApplicationId(dto.applicationId);
    const setupAttemptId = this.normalizeApplicationId(dto.idempotencyKey);
    const setup = await this.savedPaymentMethodGateway.createSetup(
      dto.guestEmail,
      `booking-request:${propertyId}:${setupAttemptId}`,
      { propertyId, applicationId },
    );
    return {
      setupIntentId: setup.setupIntentId,
      clientSecret: setup.clientSecret,
      clientMode: setup.clientMode,
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
      await this.deliverEmailsBestEffort(existing.id, propertyId);
      return acknowledgement;
    }

    const config = await this.configService.getPublicConfig(propertyId);
    this.assertRequestMode(config);
    this.assertConfiguredOffer(config, dto.roomTypeId, dto.ratePlanId);

    const applicationAnswers = validateApplicationAnswers(
      config.formQuestions,
      dto.applicationAnswers,
    );
    this.assertCardCollectionCapability(
      config,
      config.paymentMethodCollection === 'required' || Boolean(dto.setupIntentId?.trim()),
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
    assertLedgerCurrencySupported(quote.currencyCode);
    const card = await this.resolveCard(
      config.paymentMethodCollection,
      dto,
      { propertyId, applicationId },
    );

    const result = await this.db.transaction(async (tx) => {
      const lockedConfig = await this.configService.getPublicConfig(propertyId, tx, true);
      if (!this.sameRequestConfig(config, lockedConfig)) {
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
          submittedTotal: quote.grandTotal,
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
          bookingRequestId: request.id,
          action: 'create',
          entityType: 'booking_request',
          entityId: request.id,
          description: 'Webhook event: booking_request.created',
          newValue: structuredClone(createdPayload),
        });
        await this.queueReceiptEmail({
          id: request.id,
          propertyId,
          guestFirstName: dto.guestFirstName,
          guestEmail: dto.guestEmail,
          arrivalDate: dto.checkIn,
          departureDate: dto.checkOut,
        }, tx);
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
    await this.deliverEmailsBestEffort(result.requestId, propertyId);
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

  private assertCardCollectionCapability(
    config: PublicRequestConfig,
    collectingCard: boolean,
  ): void {
    if (!collectingCard) return;

    if (config.paymentMethodClientMode === 'unsupported') {
      throw new BadRequestException('Payment method collection is unavailable for this property');
    }
    if ((config.paymentMethodClientMode ?? 'stripe') === 'stripe'
      && !config.stripePublishableKey?.trim()) {
      throw new BadRequestException('Payment method collection is unavailable for this property');
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
    const byDate = new Map<string, number>(
      (availability as Array<{ roomTypeId: string; date: string; available: number }>)
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
    return stableSerialize(value);
  }

  private assertAcceptedStayAmendmentRequest(
    request: typeof bookingRequests.$inferSelect,
  ): void {
    if (request.status !== 'accepted') {
      throw new ConflictException('Only accepted booking requests can amend a stay');
    }
    if (!request.acceptedReservationId || !request.acceptedFolioId) {
      throw new ConflictException(
        `Accepted booking request ${request.id} has no linked operational stay`,
      );
    }
  }

  private async buildStayAmendmentPreview(
    request: typeof bookingRequests.$inferSelect,
    reservation: typeof reservations.$inferSelect,
    dates: Pick<PreviewBookingRequestStayAmendmentDto, 'arrivalDate' | 'departureDate'>,
    db: any,
    lockForUpdate: boolean,
  ) {
    assertCanonicalStayDates(dates.arrivalDate, dates.departureDate);
    const previousPricing = reservation.acceptedPricingSnapshot as AcceptedPricingSnapshot | null;
    if (!previousPricing) {
      throw new ConflictException('Linked reservation has no accepted operational pricing basis');
    }
    if (
      request.currencyCode !== reservation.currencyCode
      || previousPricing.currencyCode !== reservation.currencyCode
    ) {
      throw new ConflictException('Booking Request and reservation currencies do not match');
    }
    const serviceQuery = db
      .select({
        id: reservationServices.id,
        serviceId: reservationServices.serviceId,
        status: reservationServices.status,
        sourceChannel: reservationServices.sourceChannel,
        createdAt: reservationServices.createdAt,
      })
      .from(reservationServices)
      .where(and(
        eq(reservationServices.propertyId, request.propertyId),
        eq(reservationServices.reservationId, reservation.id),
      ));
    const serviceRows = lockForUpdate && typeof serviceQuery.for === 'function'
      ? await serviceQuery.for('update')
      : await serviceQuery;
    const matchedServiceRows = matchAcceptedReservationServiceRows(previousPricing, serviceRows);
    const missingOperationalService = previousPricing.services.find(
      (service) => service.postingRule !== 'on_consumption'
        && !matchedServiceRows.has(service.serviceId),
    );
    if (missingOperationalService) {
      throw new ConflictException(
        `Accepted service ${missingOperationalService.code} has no linked reservation service`,
      );
    }
    const cancelledServiceIds = new Set(
      previousPricing.services
        .map((service) => service.serviceId)
        .filter((serviceId) => {
          const row = matchedServiceRows.get(serviceId);
          return !row || row.status === 'cancelled';
        }),
    );
    const operationalPreviousPricing = withoutCancelledAcceptedServices(
      previousPricing,
      cancelledServiceIds,
    );
    const currentQuote = await this.bookingEngineService.quote(request.propertyId, {
      roomTypeId: reservation.roomTypeId,
      ratePlanId: reservation.ratePlanId,
      checkIn: dates.arrivalDate,
      checkOut: dates.departureDate,
      adults: reservation.adults,
      children: reservation.children,
      serviceIds: operationalPreviousPricing.services.map((service) => service.serviceId),
    }, lockForUpdate ? db : undefined, lockForUpdate
      ? { lockForUpdate: true, excludeReservationId: reservation.id }
      : { excludeReservationId: reservation.id });
    const priorPricing = buildPriorAmendedPricingSnapshot(
      operationalPreviousPricing,
      dates.arrivalDate,
      dates.departureDate,
    );
    const currentPricing = buildAmendedPricingSnapshot({
      source: 'current',
      previous: operationalPreviousPricing,
      currentQuote,
      currencyCode: reservation.currencyCode,
      arrivalDate: dates.arrivalDate,
      departureDate: dates.departureDate,
    });
    const previewToken = amendmentPreviewFingerprint({
      requestId: request.id,
      propertyId: request.propertyId,
      reservationId: reservation.id,
      reservationUpdatedAt: reservation.updatedAt,
      previousArrivalDate: reservation.arrivalDate,
      previousDepartureDate: reservation.departureDate,
      previousTotal: reservation.totalAmount,
      previousPricing: operationalPreviousPricing,
      arrivalDate: dates.arrivalDate,
      departureDate: dates.departureDate,
      currentQuote,
    });
    return {
      requestId: request.id,
      reservationId: reservation.id,
      previousArrivalDate: reservation.arrivalDate,
      previousDepartureDate: reservation.departureDate,
      previousTotal: operationalPreviousPricing.grandTotal,
      arrivalDate: dates.arrivalDate,
      departureDate: dates.departureDate,
      priorTotal: priorPricing.grandTotal,
      currentTotal: currentPricing.grandTotal,
      currencyCode: reservation.currencyCode,
      priorPricing,
      currentPricing,
      currentQuote,
      operationalPreviousPricing,
      previewVersion: 1 as const,
      previewToken,
    };
  }

  private normalizeStayAmendmentIdempotencyKey(value: string): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 200) {
      throw new BadRequestException('A valid stay amendment idempotency key is required');
    }
    return normalized;
  }

  private stayAmendmentOperationFingerprint(
    requestId: string,
    propertyId: string,
    input: AmendBookingRequestStayDto,
  ): string {
    if (!['prior', 'current', 'custom'].includes(input.priceSource)) {
      throw new BadRequestException('A valid stay amendment price source is required');
    }
    return createHash('sha256').update(stableSerialize({
      version: 1,
      requestId,
      propertyId,
      arrivalDate: input.arrivalDate,
      departureDate: input.departureDate,
      priceSource: input.priceSource,
      previewToken: input.previewToken,
      customTotal: input.customTotal ?? null,
      customReason: input.customReason?.trim() || null,
    })).digest('hex');
  }

  private async lockProperty(tx: any, propertyId: string) {
    const candidates = await tx
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .for('update');
    const property = candidates.find((candidate: typeof properties.$inferSelect) =>
      candidate.id === propertyId);
    if (!property) throw new NotFoundException(`Property ${propertyId} not found`);
    return property;
  }

  private async lockLinkedReservation(
    tx: any,
    request: typeof bookingRequests.$inferSelect,
    propertyId: string,
  ): Promise<typeof reservations.$inferSelect> {
    const candidates = await tx
      .select()
      .from(reservations)
      .where(and(
        eq(reservations.id, request.acceptedReservationId!),
        eq(reservations.propertyId, propertyId),
      ))
      .for('update');
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

  private async findExistingStayAmendment(
    db: any,
    propertyId: string,
    requestId: string,
    idempotencyKey: string,
    operationFingerprint: string,
  ): Promise<typeof bookingRequestStayAmendments.$inferSelect | undefined> {
    const candidates = await db
      .select()
      .from(bookingRequestStayAmendments)
      .where(and(
        eq(bookingRequestStayAmendments.propertyId, propertyId),
        or(
          eq(bookingRequestStayAmendments.idempotencyKey, idempotencyKey),
          and(
            eq(bookingRequestStayAmendments.bookingRequestId, requestId),
            eq(bookingRequestStayAmendments.operationFingerprint, operationFingerprint),
          ),
        ),
      ));
    const scoped = candidates.filter((candidate: typeof bookingRequestStayAmendments.$inferSelect) =>
      candidate.propertyId === propertyId);
    const keyMatch = scoped.find((candidate: typeof bookingRequestStayAmendments.$inferSelect) =>
      candidate.idempotencyKey === idempotencyKey);
    if (keyMatch && (
      keyMatch.bookingRequestId !== requestId
      || keyMatch.operationFingerprint !== operationFingerprint
    )) {
      throw new ConflictException('Stay amendment idempotency key was already used');
    }
    return keyMatch ?? scoped.find((candidate: typeof bookingRequestStayAmendments.$inferSelect) =>
      candidate.bookingRequestId === requestId
      && candidate.operationFingerprint === operationFingerprint);
  }

  private toStayAmendmentResult(
    amendment: Pick<
      typeof bookingRequestStayAmendments.$inferSelect,
      | 'id'
      | 'bookingRequestId'
      | 'reservationId'
      | 'folioId'
      | 'previousArrivalDate'
      | 'previousDepartureDate'
      | 'newArrivalDate'
      | 'newDepartureDate'
      | 'previousTotalAmount'
      | 'newTotalAmount'
      | 'currencyCode'
      | 'priceSource'
      | 'reason'
    >,
  ): StayAmendmentResult {
    return {
      amendmentId: amendment.id,
      requestId: amendment.bookingRequestId,
      reservationId: amendment.reservationId,
      folioId: amendment.folioId,
      previousArrivalDate: amendment.previousArrivalDate,
      previousDepartureDate: amendment.previousDepartureDate,
      arrivalDate: amendment.newArrivalDate,
      departureDate: amendment.newDepartureDate,
      previousTotalAmount: amendment.previousTotalAmount,
      newTotalAmount: amendment.newTotalAmount,
      currencyCode: amendment.currencyCode,
      priceSource: amendment.priceSource,
      reason: amendment.reason,
    };
  }

  private throwStayAmendmentError(error: unknown): never {
    if (error instanceof BadRequestException && /availability/i.test(error.message)) {
      throw new ConflictException(error.message);
    }
    throw error;
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
    options: { audit?: boolean } = {},
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
    if (options.audit !== false) {
      await tx.insert(auditLogs).values({
        propertyId,
        bookingRequestId: requestId,
        action: 'create',
        entityType: payload.entityType,
        entityId: payload.entityId,
        description: `Webhook event: ${payload.event}`,
        newValue: persistedPayload,
      });
    }
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
  ): BookingRequestCreatedWebhook {
    return {
      event: 'booking_request.created',
      entityType: 'booking_request',
      entityId: requestId,
      propertyId,
      data: { requestId, status: 'pending' },
      timestamp: new Date().toISOString(),
    };
  }

  private async queueReceiptEmail(
    request: Pick<
      typeof bookingRequests.$inferSelect,
      'id' | 'propertyId' | 'guestFirstName' | 'guestEmail' | 'arrivalDate' | 'departureDate'
    >,
    executor: EmailQueueExecutor,
  ): Promise<void> {
    const content = requestReceivedEmail({
      guestFirstName: request.guestFirstName,
      arrivalDate: request.arrivalDate,
      departureDate: request.departureDate,
    });
    await this.mailer.queue({
      propertyId: request.propertyId,
      bookingRequestId: request.id,
      logicalKey: 'request:receipt',
      kind: 'receipt',
      recipient: request.guestEmail,
      ...content,
    }, executor);
  }

  private async queueAcceptedEmail(
    request: Pick<
      typeof bookingRequests.$inferSelect,
      | 'id'
      | 'propertyId'
      | 'guestFirstName'
      | 'guestEmail'
      | 'arrivalDate'
      | 'departureDate'
      | 'acceptedTotal'
      | 'currencyCode'
    >,
    executor: EmailQueueExecutor,
  ): Promise<void> {
    if (!request.acceptedTotal) return;
    const content = acceptedBookingRequestEmail({
      guestFirstName: request.guestFirstName,
      arrivalDate: request.arrivalDate,
      departureDate: request.departureDate,
      acceptedTotal: request.acceptedTotal,
      currencyCode: request.currencyCode,
    });
    await this.mailer.queue({
      propertyId: request.propertyId,
      bookingRequestId: request.id,
      logicalKey: 'decision:accepted',
      kind: 'accepted',
      recipient: request.guestEmail,
      ...content,
    }, executor);
  }

  private async queueDeniedEmail(
    request: Pick<
      typeof bookingRequests.$inferSelect,
      'id' | 'propertyId' | 'guestFirstName' | 'guestEmail' | 'arrivalDate' | 'departureDate'
    >,
    executor: EmailQueueExecutor,
  ): Promise<void> {
    const content = deniedBookingRequestEmail({
      guestFirstName: request.guestFirstName,
      arrivalDate: request.arrivalDate,
      departureDate: request.departureDate,
    });
    await this.mailer.queue({
      propertyId: request.propertyId,
      bookingRequestId: request.id,
      logicalKey: 'decision:denied',
      kind: 'denied',
      recipient: request.guestEmail,
      ...content,
    }, executor);
  }

  private async queueAcceptedEmailBestEffort(
    request: Parameters<BookingRequestService['queueAcceptedEmail']>[0],
    propertyId: string,
  ): Promise<void> {
    try {
      await this.queueAcceptedEmail(request, this.db);
    } catch (error: unknown) {
      this.logEmailConsequenceFailure(request.id, propertyId, error);
    }
  }

  private async queueDeniedEmailBestEffort(
    request: Parameters<BookingRequestService['queueDeniedEmail']>[0],
    propertyId: string,
  ): Promise<void> {
    try {
      await this.queueDeniedEmail(request, this.db);
    } catch (error: unknown) {
      this.logEmailConsequenceFailure(request.id, propertyId, error);
    }
  }

  private async deliverEmailsBestEffort(requestId: string, propertyId: string): Promise<void> {
    try {
      await this.mailer.deliverForRequestBestEffort(requestId, propertyId);
    } catch (error: unknown) {
      this.logEmailConsequenceFailure(requestId, propertyId, error);
    }
  }

  private logEmailConsequenceFailure(
    requestId: string,
    _propertyId: string,
    error: unknown,
  ): void {
    this.logger.error(
      `Booking request ${requestId} was committed but its email consequence failed`,
      error instanceof Error ? error.stack : undefined,
    );
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

  /**
   * `locked` comes from `configService.getPublicConfig(propertyId, tx, true)`
   * — already validated/filtered/sorted the same way `initial` was when the
   * submission first quoted, so both snapshots are directly comparable
   * without re-running form-question validation here.
   */
  private sameRequestConfig(
    initial: PublicRequestConfig,
    locked: PublicRequestConfig,
  ): boolean {
    const snapshot = (config: PublicRequestConfig) => ({
      propertyId: config.propertyId,
      isEnabled: config.isEnabled,
      bookingMode: config.bookingMode,
      paymentMethodCollection: config.paymentMethodCollection,
      stripePublishableKey: config.stripePublishableKey,
      sellableRoomTypeIds: config.sellableRoomTypeIds,
      sellableRatePlanIds: config.sellableRatePlanIds,
      depositPolicy: config.depositPolicy,
      formQuestions: config.formQuestions,
    });
    return this.stableSerialize(snapshot(initial)) === this.stableSerialize(snapshot(locked));
  }
}
