import type { auditLogs, bookingRequests, reservations } from '@telivityhaip/database';

type BookingRequestRow = typeof bookingRequests.$inferSelect;
type ReservationRow = typeof reservations.$inferSelect;
type AuditLogRow = typeof auditLogs.$inferSelect;

export interface BookingRequestListItemDto {
  id: string;
  propertyId: string;
  status: BookingRequestRow['status'];
  arrivalDate: string;
  departureDate: string;
  roomTypeId: string;
  ratePlanId: string;
  adults: number;
  children: number;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  hasCard: boolean;
  submittedTotal: string;
  currencyCode: string;
  acceptedPriceSource: BookingRequestRow['acceptedPriceSource'];
  acceptedTotal: string | null;
  acceptedReservationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingRequestDetailDto extends Omit<BookingRequestListItemDto, 'hasCard'> {
  guestPhone: string | null;
  specialRequests: string | null;
  serviceIds: string[];
  formSnapshot: BookingRequestRow['formSnapshot'];
  applicationAnswers: BookingRequestRow['applicationAnswers'];
  submittedQuoteSnapshot: unknown;
  currentQuoteSnapshot: unknown;
  currencyCode: string;
  card: { brand: string | null; lastFour: string | null } | null;
  customPriceReason: string | null;
  acceptedFolioId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  denialReason: string | null;
}

export interface AcceptedBookingRequestDecisionDto {
  requestId: string;
  status: 'accepted';
  reservationId: string;
  folioId: string | null;
  totalAmount: string;
  currencyCode: string;
  priceSource: BookingRequestRow['acceptedPriceSource'];
  customReason: string | null;
}

export interface DeniedBookingRequestDecisionDto {
  requestId: string;
  status: 'denied';
  denialReason: string;
  decidedAt: Date | null;
}

export interface BookingRequestAuditHistoryItemDto {
  id: string;
  action: string;
  actorDisplay: string;
  occurredAt: Date;
  summary: string;
  details: Record<string, string | number | boolean | null>;
}

const AUDIT_DETAIL_KEYS: Record<string, readonly string[]> = {
  booking_request: [
    'status', 'reservationId', 'folioId', 'priceSource', 'acceptedTotal',
    'customPriceReason', 'denialReason',
  ],
  booking_request_installment: [
    'label', 'sortOrder', 'fixedAmount', 'percentage', 'resolvedAmount',
    'dueMilestone', 'dueDate', 'allocatedAmount', 'status',
  ],
  booking_request_payment_allocation: [
    'paymentId', 'installmentId', 'amount', 'reason',
  ],
  payment: ['folioId', 'amount', 'currencyCode', 'method', 'status', 'result'],
  booking_request_payment_resolution: ['paymentId', 'type', 'amount', 'reason', 'status'],
  booking_request_email_delivery: ['kind', 'status', 'attempts', 'automaticAttempts', 'mode'],
};

function safeAuditDetails(row: AuditLogRow) {
  const source = (
    row.newValue && typeof row.newValue === 'object'
      ? row.newValue
      : row.previousValue && typeof row.previousValue === 'object'
        ? row.previousValue
        : {}
  ) as Record<string, unknown>;
  const details: Record<string, string | number | boolean | null> = {};
  for (const key of AUDIT_DETAIL_KEYS[row.entityType] ?? []) {
    const value = source[key];
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) details[key] = value;
  }
  return details;
}

function auditSummary(
  row: AuditLogRow,
  details: Record<string, string | number | boolean | null>,
): string {
  const known = (value: unknown, allowed: readonly string[], fallback: string) =>
    typeof value === 'string' && allowed.includes(value) ? value : fallback;
  if (row.entityType === 'booking_request') {
    return `request.${known(details['status'], ['pending', 'accepted', 'denied'], 'updated')}`;
  }
  if (row.entityType === 'booking_request_installment') {
    return `installment.${row.action === 'create' ? 'created' : row.action === 'delete' ? 'deleted' : 'updated'}`;
  }
  if (row.entityType === 'booking_request_payment_allocation') {
    return `allocation.${row.action === 'delete' ? 'removed' : 'recorded'}`;
  }
  if (row.entityType === 'payment') {
    return `payment.${known(
      details['status'],
      ['pending', 'captured', 'failed'],
      row.action === 'create' ? 'recorded' : 'updated',
    )}`;
  }
  if (row.entityType === 'booking_request_payment_resolution') {
    return `resolution.${known(
      details['type'],
      ['refund', 'external_return', 'retained'],
      'recorded',
    )}`;
  }
  if (row.entityType === 'booking_request_email_delivery') {
    return `email.${known(
      details['status'],
      ['pending', 'processing', 'sent', 'failed'],
      row.action === 'create' ? 'queued' : 'updated',
    )}`;
  }
  return 'request.updated';
}

export function toBookingRequestAuditHistoryItem(
  row: AuditLogRow,
): BookingRequestAuditHistoryItemDto {
  const details = safeAuditDetails(row);
  return {
    id: row.id,
    action: row.action,
    actorDisplay: row.userEmail || (row.userId ? 'Staff' : 'System'),
    occurredAt: row.occurredAt,
    summary: auditSummary(row, details),
    details,
  };
}

export function toBookingRequestListItem(
  row: BookingRequestRow,
): BookingRequestListItemDto {
  const submittedQuote = row.submittedQuoteSnapshot as Record<string, unknown>;
  const submittedTotal = submittedQuote['grandTotal'];
  if (typeof submittedTotal !== 'string' && typeof submittedTotal !== 'number') {
    throw new TypeError(`Booking request ${row.id} has no submitted quote total`);
  }
  return {
    id: row.id,
    propertyId: row.propertyId,
    status: row.status,
    arrivalDate: row.arrivalDate,
    departureDate: row.departureDate,
    roomTypeId: row.roomTypeId,
    ratePlanId: row.ratePlanId,
    adults: row.adults,
    children: row.children,
    guestFirstName: row.guestFirstName,
    guestLastName: row.guestLastName,
    guestEmail: row.guestEmail,
    hasCard: Boolean(row.stripePaymentMethodId),
    submittedTotal: String(submittedTotal),
    currencyCode: row.currencyCode,
    acceptedPriceSource: row.acceptedPriceSource,
    acceptedTotal: row.acceptedTotal,
    acceptedReservationId: row.acceptedReservationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toBookingRequestDetail(
  row: BookingRequestRow,
): BookingRequestDetailDto {
  const { hasCard: _hasCard, ...summary } = toBookingRequestListItem(row);
  void _hasCard;
  return {
    ...summary,
    guestPhone: row.guestPhone,
    specialRequests: row.specialRequests,
    serviceIds: row.serviceIds,
    formSnapshot: row.formSnapshot,
    applicationAnswers: row.applicationAnswers,
    submittedQuoteSnapshot: row.submittedQuoteSnapshot,
    currentQuoteSnapshot: row.currentQuoteSnapshot,
    card: row.cardBrand || row.cardLastFour
      ? { brand: row.cardBrand, lastFour: row.cardLastFour }
      : null,
    customPriceReason: row.customPriceReason,
    acceptedFolioId: row.acceptedFolioId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    denialReason: row.denialReason,
  };
}

export function toAcceptedBookingRequestDecision(
  request: Pick<
    BookingRequestRow,
    | 'id'
    | 'acceptedFolioId'
    | 'acceptedTotal'
    | 'currencyCode'
    | 'acceptedPriceSource'
    | 'customPriceReason'
  >,
  reservation: Pick<ReservationRow, 'id' | 'totalAmount' | 'currencyCode'>,
): AcceptedBookingRequestDecisionDto {
  return {
    requestId: request.id,
    status: 'accepted',
    reservationId: reservation.id,
    folioId: request.acceptedFolioId,
    totalAmount: request.acceptedTotal ?? reservation.totalAmount,
    currencyCode: reservation.currencyCode ?? request.currencyCode,
    priceSource: request.acceptedPriceSource,
    customReason: request.customPriceReason,
  };
}

export function toDeniedBookingRequestDecision(
  request: Pick<BookingRequestRow, 'id' | 'denialReason' | 'decidedAt'>,
): DeniedBookingRequestDecisionDto {
  return {
    requestId: request.id,
    status: 'denied',
    denialReason: request.denialReason ?? '',
    decidedAt: request.decidedAt,
  };
}
