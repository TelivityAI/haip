import type { Type } from '@nestjs/common';
import { BOOKING_REQUEST_STRIPE_HANDLER } from './modules/payment/booking-request-stripe-handler.interface';

let cachedModules: Type[] | null | undefined;

/** Preload optional booking-requests Nest modules when the feature flag is on. */
export async function preloadBookingRequestsModules(): Promise<void> {
  if (process.env['HAIP_BOOKING_REQUESTS'] !== 'true') {
    cachedModules = null;
    return;
  }
  if (cachedModules !== undefined) return;

  const [{ createBookingRequestsRootModule }, { BookingRequestModule }] = await Promise.all([
    import('@telivityhaip/booking-requests'),
    import('./modules/booking-request/booking-request.module.js'),
  ]);

  cachedModules = [
    createBookingRequestsRootModule({
      bookingRequestModule: BookingRequestModule,
      stripeHandlerToken: BOOKING_REQUEST_STRIPE_HANDLER,
    }),
  ];
}

export function bookingRequestsModules(): Type[] {
  if (process.env['HAIP_BOOKING_REQUESTS'] !== 'true') return [];
  if (!cachedModules) {
    throw new Error(
      'Booking requests is enabled but modules were not preloaded — call preloadBookingRequestsModules() before bootstrapping Nest',
    );
  }
  return cachedModules;
}
