export const bookingRequestKeys = {
  root: (propertyId: string) => ['booking-requests', propertyId] as const,
  list: (propertyId: string, filters: Record<string, unknown>) =>
    ['booking-requests', propertyId, 'list', filters] as const,
  detail: (propertyId: string, requestId: string) =>
    ['booking-requests', propertyId, 'detail', requestId] as const,
  payments: (propertyId: string, requestId: string) =>
    ['booking-request-payments', propertyId, requestId] as const,
  installments: (propertyId: string, requestId: string) =>
    ['booking-request-installments', propertyId, requestId] as const,
  messages: (propertyId: string, requestId: string) =>
    ['booking-request-messages', propertyId, requestId] as const,
  audit: (propertyId: string, requestId: string) =>
    ['booking-request-audit', propertyId, requestId] as const,
  folio: (propertyId: string, folioId: string) =>
    ['folios', propertyId, folioId] as const,
};
