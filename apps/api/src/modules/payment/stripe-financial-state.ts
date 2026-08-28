/**
 * Canonical definition lives in @telivityhaip/shared — this logic is shared
 * between core's `resolvePaymentForIntent` (stripe-webhook.controller.ts) and
 * @telivityhaip/booking-requests' Stripe handler, so it cannot live only in
 * apps/api without the package importing apps/api.
 */
export {
  type HaipMetadataClassification,
  type HaipMetadataOwnership,
  type PaymentIntentCorrelation,
  type PaymentIntentEvent,
  type PaymentIntentLedgerStatus,
  type RefundCorrelation,
  type RefundProviderStatus,
  classifyHaipMetadata,
  decidePaymentIntentTransition,
  decideRefundTransition,
  hasHaipFinancialMetadata,
  paymentIntentCorrelation,
  refundCorrelation,
} from '@telivityhaip/shared';
