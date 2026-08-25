export type BookingRequestStatus = 'pending' | 'accepted' | 'denied';
export type BookingRequestPriceSource = 'submitted' | 'current' | 'custom' | null;

export interface QuoteSnapshot {
  currencyCode?: string;
  grandTotal?: string;
  roomTotal?: string;
  taxTotal?: string;
  servicesTotal?: string;
  lineItems?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface BookingFormQuestionSnapshot {
  id: string;
  label: string;
  type: string;
  order: number;
  isActive: boolean;
  isRequired: boolean;
  options?: string[];
}

export interface BookingRequestListItem {
  id: string;
  propertyId: string;
  status: BookingRequestStatus;
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
  acceptedPriceSource: BookingRequestPriceSource;
  acceptedTotal: string | null;
  acceptedReservationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingRequestDetail extends Omit<BookingRequestListItem, 'hasCard'> {
  guestPhone: string | null;
  specialRequests: string | null;
  serviceIds: string[];
  formSnapshot: BookingFormQuestionSnapshot[];
  applicationAnswers: Record<string, unknown>;
  submittedQuoteSnapshot: QuoteSnapshot;
  currentQuoteSnapshot: QuoteSnapshot | null;
  card: { brand: string | null; lastFour: string | null } | null;
  customPriceReason: string | null;
  acceptedFolioId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  denialReason: string | null;
}

export interface BookingRequestAcceptancePreview {
  requestId: string;
  submittedTotal: string;
  currentTotal: string;
  currencyCode: string;
  previewVersion: 1;
  previewToken: string;
}

export interface BookingRequestAuditHistoryItem {
  source: 'audit_log';
  id: string;
  action: string;
  actorDisplay: string;
  occurredAt: string;
  summary: string;
  details: Record<string, string | number | boolean | null>;
}

export interface BookingRequestInstallment {
  id: string;
  propertyId: string;
  bookingRequestId: string;
  label: string;
  sortOrder: number;
  fixedAmount: string | null;
  percentage: string | null;
  resolvedAmount: string;
  dueMilestone: 'date' | 'arrival' | 'checkout' | 'manual';
  dueDate: string | null;
  allocatedAmount: string;
  status: 'unpaid' | 'partial' | 'paid';
  createdAt?: string;
  updatedAt?: string;
}

export interface BookingRequestPayment {
  id: string;
  propertyId: string;
  bookingRequestId: string;
  folioId: string | null;
  method: string;
  status: string;
  amount: string;
  netCapturedAmount: string;
  allocatedAmount: string;
  reservedResolutionAmount: string;
  availableToAllocate: string;
  availableToResolve: string;
  unresolvedAmount: string;
  returnedAmount: string;
  retainedAmount: string;
  /** @deprecated Use availableToAllocate. */
  availableAmount: string;
  currencyCode: string;
  source: 'saved_card' | 'external';
  gatewayProvider: string | null;
  reference: string | null;
  cardLastFour: string | null;
  cardBrand: string | null;
  originalPaymentId: string | null;
  notes: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingRequestPaymentAllocation {
  id: string;
  propertyId: string;
  bookingRequestId: string;
  paymentId: string;
  installmentId: string;
  amount: string;
  createdAt: string;
}

export interface BookingRequestPaymentResolution {
  id: string;
  propertyId: string;
  bookingRequestId: string;
  paymentId: string;
  type: 'refund' | 'external_return' | 'retained';
  status: string;
  amount: string;
  movementId: string | null;
  reason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingRequestPaymentsResponse {
  movements: BookingRequestPayment[];
  allocations: BookingRequestPaymentAllocation[];
  resolutions: BookingRequestPaymentResolution[];
}

export interface BookingRequestEmailDelivery {
  id: string;
  kind: 'receipt' | 'accepted' | 'denied' | 'payment' | 'refund' | 'failure';
  status: 'pending' | 'processing' | 'sent' | 'failed';
  subject: string;
  bodyText: string;
  errorMessage: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolioSummary {
  id: string;
  folioNumber: string;
  status: string;
  totalCharges: string;
  totalPayments: string;
  balance: string;
  currencyCode: string;
}

export interface UnresolvedPayment {
  payment: BookingRequestPayment;
  amount: number;
}

export function quoteTotal(snapshot: QuoteSnapshot | null | undefined): string | null {
  return typeof snapshot?.grandTotal === 'string' ? snapshot.grandTotal : null;
}

export function unresolvedPayments(
  response: BookingRequestPaymentsResponse | undefined,
): UnresolvedPayment[] {
  if (!response) return [];
  const unresolved: UnresolvedPayment[] = [];
  for (const payment of response.movements) {
    if (payment.originalPaymentId) continue;
    const amount = Number(payment.unresolvedAmount);
    if (amount > 0.000001) unresolved.push({ payment, amount });
  }
  return unresolved;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    const message = response?.data?.message;
    if (Array.isArray(message)) return message.map(String).join(', ');
    if (typeof message === 'string' && message.trim()) return message;
    const direct = (error as { message?: unknown }).message;
    if (typeof direct === 'string' && direct.trim()) return direct;
  }
  return fallback;
}
