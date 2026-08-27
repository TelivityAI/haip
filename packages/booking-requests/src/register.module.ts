import { DynamicModule, Module, type Type } from '@nestjs/common';

export type BookingRequestsRootModuleOptions = {
  /**
   * Nest module class from the API app (BookingRequestModule). It must itself
   * provide and export the BOOKING_REQUEST_STRIPE_HANDLER token consumed by
   * core PaymentModule/StripeWebhookController — this root module only wires
   * the module into the app, it does not re-provide that token.
   */
  bookingRequestModule: Type<unknown>;
};

/**
 * Wires the optional booking-requests feature into the API without fusing
 * feature code into core modules. Called from AppModule when
 * HAIP_BOOKING_REQUESTS=true.
 */
export function createBookingRequestsRootModule(
  options: BookingRequestsRootModuleOptions,
): DynamicModule {
  @Module({})
  class BookingRequestsRootModule {}

  return {
    module: BookingRequestsRootModule,
    global: true,
    imports: [options.bookingRequestModule],
    exports: [options.bookingRequestModule],
  };
}
