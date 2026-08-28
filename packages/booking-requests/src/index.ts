export { BookingRequestModule } from './module/booking-request.module.js';
export type {
  BookingRequestModuleOptions,
  BookingRequestPortBinding,
} from './module/booking-request.module.js';
export {
  AncillaryServicePort,
  AvailabilityServicePort,
  BookingEngineConfigServicePort,
  BookingEngineScopeGuardPort,
  BookingEngineServicePort,
  BookingKeyGuardPort,
  BookingThrottleGuardPort,
  EmailServicePort,
  FolioServicePort,
  GuestServicePort,
  RatePlanServicePort,
  ReservationServicePort,
  WebhookServicePort,
} from './module/ports.js';
export type {
  PortEmailDeliveryStatus,
  PortEmailMessage,
  PortEmailResult,
  PortEmailSendOptions,
  PublicBookingEngineConfig,
} from './module/ports.js';
export { isBookingRequestsEnabled } from './enabled.js';
/**
 * Domain services + controllers, exported for apps/api's kept regression/e2e/
 * authorization specs (see `apps/api/src/modules/booking-request/*.spec.ts`),
 * which construct the real Nest test module directly instead of going
 * through `BookingRequestModule.forRoot(...)`. This is the normal, expected
 * direction of the package boundary — apps/api MAY always import from this
 * package; only the reverse (this package importing apps/api) is forbidden.
 */
export { BookingRequestService } from './domain/booking-request.service.js';
export { BookingRequestPaymentService } from './domain/booking-request-payment.service.js';
export { BookingRequestMailerService } from './domain/booking-request-mailer.service.js';
export { BookingRequestConsequenceWorkerService } from './domain/booking-request-consequence-worker.service.js';
export { BookingRequestStripeHandler } from './domain/booking-request-stripe.handler.js';
export { BookingRequestController } from './http/booking-request.controller.js';
export { BookingRequestPublicController } from './http/booking-request-public.controller.js';
