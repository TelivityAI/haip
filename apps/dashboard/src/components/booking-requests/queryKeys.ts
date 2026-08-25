export const bookingRequestKeys = {
  root: (propertyId: string) => ['booking-requests', propertyId] as const,
  list: (propertyId: string, filters: Record<string, unknown>) =>
    ['booking-requests', propertyId, 'list', filters] as const,
  detail: (propertyId: string, requestId: string) =>
    ['booking-requests', propertyId, 'detail', requestId] as const,
  acceptancePreview: (propertyId: string, requestId: string) =>
    ['booking-requests', propertyId, 'acceptance-preview', requestId] as const,
  paymentsRoot: (propertyId: string) => ['booking-request-payments', propertyId] as const,
  payments: (propertyId: string, requestId: string) =>
    ['booking-request-payments', propertyId, requestId] as const,
  installmentsRoot: (propertyId: string) => ['booking-request-installments', propertyId] as const,
  installments: (propertyId: string, requestId: string) =>
    ['booking-request-installments', propertyId, requestId] as const,
  messagesRoot: (propertyId: string) => ['booking-request-messages', propertyId] as const,
  messages: (propertyId: string, requestId: string) =>
    ['booking-request-messages', propertyId, requestId] as const,
  auditRoot: (propertyId: string) => ['booking-request-audit', propertyId] as const,
  audit: (propertyId: string, requestId: string) =>
    ['booking-request-audit', propertyId, requestId] as const,
  foliosRoot: (propertyId: string) => ['booking-request-folios', propertyId] as const,
  folio: (propertyId: string, folioId: string) =>
    ['booking-request-folios', propertyId, folioId] as const,
};
