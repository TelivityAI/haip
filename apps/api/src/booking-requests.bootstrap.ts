import type { DynamicModule, Type } from '@nestjs/common';

let cachedModules: Array<Type | DynamicModule> | null | undefined;

/**
 * Builds the `@telivityhaip/booking-requests` package's `BookingRequestModule.forRoot(...)`
 * DynamicModule, binding every port it declares to the concrete core singleton
 * that satisfies it (mostly `useExisting`). This is the ONLY place core wires
 * itself to the optional package — the package itself never imports from
 * `apps/api`.
 */
async function buildBookingRequestsModule(): Promise<DynamicModule> {
  const [
    { BookingRequestModule },
    { AncillaryModule },
    { AncillaryService },
    { BookingEngineModule },
    { BookingEngineService },
    { BookingEngineConfigService },
    { BookingKeyGuard },
    { BookingEngineScopeGuard },
    { BookingThrottleGuard },
    { EmailModule },
    { EmailService },
    { FolioModule },
    { FolioService },
    { GuestModule },
    { GuestService },
    { PaymentModule },
    { RatePlanModule },
    { RatePlanService },
    { ReservationModule },
    { ReservationService },
    { AvailabilityService },
    { WebhookModule },
    { WebhookService },
  ] = await Promise.all([
    import('@telivityhaip/booking-requests'),
    import('./modules/ancillary/ancillary.module.js'),
    import('./modules/ancillary/ancillary.service.js'),
    import('./modules/booking-engine/booking-engine.module.js'),
    import('./modules/booking-engine/booking-engine.service.js'),
    import('./modules/booking-engine/booking-engine-config.service.js'),
    import('./modules/auth/booking-key.guard.js'),
    import('./modules/auth/booking-engine-scope.guard.js'),
    import('./modules/booking-engine/booking-throttle.guard.js'),
    import('./modules/agent/guest-comms/email.module.js'),
    import('./modules/agent/guest-comms/email.service.js'),
    import('./modules/folio/folio.module.js'),
    import('./modules/folio/folio.service.js'),
    import('./modules/guest/guest.module.js'),
    import('./modules/guest/guest.service.js'),
    import('./modules/payment/payment.module.js'),
    import('./modules/rate-plan/rate-plan.module.js'),
    import('./modules/rate-plan/rate-plan.service.js'),
    import('./modules/reservation/reservation.module.js'),
    import('./modules/reservation/reservation.service.js'),
    import('./modules/reservation/availability.service.js'),
    import('./modules/webhook/webhook.module.js'),
    import('./modules/webhook/webhook.service.js'),
  ]);

  return BookingRequestModule.forRoot({
    imports: [
      AncillaryModule,
      BookingEngineModule,
      EmailModule,
      FolioModule,
      GuestModule,
      // PaymentModule is required not only for FolioService's payment side
      // effects but so SAVED_PAYMENT_METHOD_GATEWAY / PAYMENT_GATEWAY — the
      // exact same @telivityhaip/shared tokens on both sides of the package
      // boundary — resolve without this module re-binding them.
      PaymentModule,
      RatePlanModule,
      ReservationModule,
      WebhookModule,
    ],
    ancillaryService: { useExisting: AncillaryService },
    availabilityService: { useExisting: AvailabilityService },
    bookingEngineService: { useExisting: BookingEngineService },
    bookingEngineConfigService: { useExisting: BookingEngineConfigService },
    emailService: { useExisting: EmailService },
    folioService: { useExisting: FolioService },
    guestService: { useExisting: GuestService },
    ratePlanService: { useExisting: RatePlanService },
    reservationService: { useExisting: ReservationService },
    webhookService: { useExisting: WebhookService },
    // Core's BookingEngineController/AuthModule own credential, scope, and
    // rate-limit enforcement — bind the package's public-controller guard
    // ports to those same singletons instead of duplicating the logic.
    bookingKeyGuard: { useExisting: BookingKeyGuard },
    bookingEngineScopeGuard: { useExisting: BookingEngineScopeGuard },
    bookingThrottleGuard: { useExisting: BookingThrottleGuard },
  });
}

/** Preload the optional booking-requests Nest module when the feature flag is on. */
export async function preloadBookingRequestsModules(): Promise<void> {
  if (process.env['HAIP_BOOKING_REQUESTS'] !== 'true') {
    cachedModules = null;
    return;
  }
  if (cachedModules !== undefined) return;

  cachedModules = [await buildBookingRequestsModule()];
}

export function bookingRequestsModules(): Array<Type | DynamicModule> {
  if (process.env['HAIP_BOOKING_REQUESTS'] !== 'true') return [];
  if (!cachedModules) {
    throw new Error(
      'Booking requests is enabled but modules were not preloaded — call preloadBookingRequestsModules() before bootstrapping Nest',
    );
  }
  return cachedModules;
}
