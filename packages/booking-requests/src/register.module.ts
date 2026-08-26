import { DynamicModule, Module, type Type } from '@nestjs/common';

export type BookingRequestsRootModuleOptions = {
  /** Nest module class from the API app (BookingRequestModule). */
  bookingRequestModule: Type<unknown>;
  /** Injection token shared with core PaymentModule (BOOKING_REQUEST_STRIPE_HANDLER). */
  stripeHandlerToken: symbol | string;
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
