import type { bookingRequests, reservations } from '@telivityhaip/database';

type BookingRequestRow = typeof bookingRequests.$inferSelect;
type ReservationRow = typeof reservations.$inferSelect;

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
}

export interface DeniedBookingRequestDecisionDto {
  requestId: string;
  status: 'denied';
  denialReason: string;
  decidedAt: Date | null;
}

export function toBookingRequestListItem(
  row: BookingRequestRow,
): BookingRequestListItemDto {
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
    currencyCode: row.currencyCode,
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
    'id' | 'acceptedFolioId' | 'acceptedTotal' | 'currencyCode'
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
