import { DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import { BOOKING_REQUEST_STRIPE_HANDLER } from '@telivityhaip/shared';
import { BookingRequestController } from '../http/booking-request.controller.js';
import { BookingRequestPublicController } from '../http/booking-request-public.controller.js';
import { BookingRequestService } from '../domain/booking-request.service.js';
import { BookingRequestPaymentService } from '../domain/booking-request-payment.service.js';
import { BookingRequestMailerService } from '../domain/booking-request-mailer.service.js';
import { BookingRequestConsequenceWorkerService } from '../domain/booking-request-consequence-worker.service.js';
import { BookingRequestStripeHandler } from '../domain/booking-request-stripe.handler.js';
import {
  BOOKING_REQUEST_CONFIG_FIELDS_PORT,
  DrizzleBookingRequestConfigFieldsAdapter,
} from './booking-request-config-fields.port.js';
import {
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
} from './ports.js';

/**
 * A DI binding for one port, without the `provide` token — the caller only
 * says HOW to resolve the port (existing core provider, class, value, or
 * factory); `BookingRequestModule.forRoot` supplies the token itself. Mirrors
 * `apps/api`'s original `BookingRequestModule`, which wired concrete core
 * services directly as `providers` — here the same concrete service is
 * passed in from `apps/api/src/booking-requests.bootstrap.ts` as `useExisting`
 * so this package never imports the concrete class.
 */
export type BookingRequestPortBinding =
  | { useExisting: Type<unknown> }
  | { useClass: Type<unknown> }
  | { useValue: unknown }
  | { useFactory: (...args: any[]) => unknown; inject?: any[] };

export interface BookingRequestModuleOptions {
  /**
   * NestJS modules (or dynamic modules) that export the concrete providers
   * every `useExisting` binding below resolves against — e.g. apps/api's
   * `AncillaryModule`, `BookingEngineModule`, `FolioModule`, etc. Brought into
   * this module's scope so `useExisting` can find them.
   *
   * MUST also include apps/api's `PaymentModule` (or an equivalent exporting
   * module): `SAVED_PAYMENT_METHOD_GATEWAY` / `PAYMENT_GATEWAY` are the exact
   * same `@telivityhaip/shared` Symbol tokens on both sides of the package
   * boundary, so this module deliberately does NOT re-provide/re-bind them —
   * they resolve straight through to whatever provides them in `imports`.
   */
  imports: Array<Type<unknown> | DynamicModule>;

  ancillaryService: BookingRequestPortBinding;
  availabilityService: BookingRequestPortBinding;
  bookingEngineService: BookingRequestPortBinding;
  bookingEngineConfigService: BookingRequestPortBinding;
  emailService: BookingRequestPortBinding;
  folioService: BookingRequestPortBinding;
  guestService: BookingRequestPortBinding;
  ratePlanService: BookingRequestPortBinding;
  reservationService: BookingRequestPortBinding;
  webhookService: BookingRequestPortBinding;

  bookingKeyGuard: BookingRequestPortBinding;
  bookingEngineScopeGuard: BookingRequestPortBinding;
  bookingThrottleGuard: BookingRequestPortBinding;
}

/**
 * Real NestJS `DynamicModule` owning every booking-requests controller,
 * service, and DTO — nothing here is a facade over `apps/api` module classes.
 * The only things this module receives from the caller are DI bindings
 * (`useExisting`, mostly) for the core PMS ports it depends on (see
 * `./ports.js`) and the `DRIZZLE` token, which stays a global provider from
 * `apps/api`'s `DatabaseModule` (see `@telivityhaip/database`'s `DRIZZLE`).
 */
@Module({})
export class BookingRequestModule {
  static forRoot(options: BookingRequestModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: AncillaryServicePort, ...options.ancillaryService },
      { provide: AvailabilityServicePort, ...options.availabilityService },
      { provide: BookingEngineServicePort, ...options.bookingEngineService },
      { provide: BookingEngineConfigServicePort, ...options.bookingEngineConfigService },
      { provide: EmailServicePort, ...options.emailService },
      { provide: FolioServicePort, ...options.folioService },
      { provide: GuestServicePort, ...options.guestService },
      { provide: RatePlanServicePort, ...options.ratePlanService },
      { provide: ReservationServicePort, ...options.reservationService },
      { provide: WebhookServicePort, ...options.webhookService },
      { provide: BookingKeyGuardPort, ...options.bookingKeyGuard },
      { provide: BookingEngineScopeGuardPort, ...options.bookingEngineScopeGuard },
      { provide: BookingThrottleGuardPort, ...options.bookingThrottleGuard },
      BookingRequestService,
      BookingRequestPaymentService,
      BookingRequestMailerService,
      BookingRequestConsequenceWorkerService,
      BookingRequestStripeHandler,
      { provide: BOOKING_REQUEST_STRIPE_HANDLER, useExisting: BookingRequestStripeHandler },
      DrizzleBookingRequestConfigFieldsAdapter,
      { provide: BOOKING_REQUEST_CONFIG_FIELDS_PORT, useExisting: DrizzleBookingRequestConfigFieldsAdapter },
    ] as Provider[];

    return {
      module: BookingRequestModule,
      // Global so BOOKING_REQUEST_STRIPE_HANDLER / BOOKING_REQUEST_CONFIG_FIELDS_PORT
      // reach apps/api's PaymentModule / BookingEngineModule (StripeWebhookController,
      // BookingEngineConfigService) without those core modules importing this
      // optional feature module — mirrors the previous apps/api facade's
      // `createBookingRequestsRootModule({ global: true })`.
      global: true,
      imports: options.imports,
      controllers: [BookingRequestPublicController, BookingRequestController],
      providers,
      exports: [
        BookingRequestService,
        BookingRequestPaymentService,
        BookingRequestMailerService,
        BOOKING_REQUEST_STRIPE_HANDLER,
        BOOKING_REQUEST_CONFIG_FIELDS_PORT,
      ],
    };
  }
}
