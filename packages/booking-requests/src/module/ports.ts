import type { CanActivate } from '@nestjs/common';
import type {
  BookingFormQuestion,
  BookingMode,
  DepositPolicy,
  PaymentMethodCollection,
} from '@telivityhaip/database';

/**
 * DI ports (tokens + lightweight interfaces) this package uses to reach core
 * apps/api services and guards without ever importing from `apps/api`.
 *
 * Each abstract class below is both the injection token AND the type the
 * package's own services/controllers depend on. `apps/api/src/booking-requests.bootstrap.ts`
 * binds each one to the real core provider with `useExisting` inside a
 * DynamicModule whose `imports` array brings the exporting core module into
 * scope — the package source itself never references an apps/api path.
 *
 * Method signatures are intentionally loose (`any` args/returns): the goal is
 * a stable *token* boundary, not re-declaring core's full DTO/entity types
 * (which would themselves require importing apps/api). Behavior is delegated
 * 1:1 to the real singleton core service via `useExisting`, so this loses no
 * runtime type safety — only compile-time checking of call arguments, which
 * mirrors the existing pragmatic approach used for the Stripe/payment ports.
 */

export abstract class FolioServicePort {
  abstract createAutoFolio(...args: any[]): Promise<any>;
  abstract recalculateBalance(...args: any[]): Promise<any>;
  abstract reconcileAcceptedStayAmendment(...args: any[]): Promise<any>;
}

export abstract class WebhookServicePort {
  abstract dispatchPersisted(...args: any[]): Promise<any>;
  abstract emit(...args: any[]): Promise<any> | any;
}

/** Trimmed local twin of apps/api's `EmailMessage` (see `EmailServicePort`). */
export interface PortEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  idempotencyKey?: string;
  messageId?: string;
}

export type PortEmailDeliveryStatus = 'sent' | 'notSent' | 'outcomeUnknown';

export interface PortEmailResult {
  status: PortEmailDeliveryStatus;
  sent: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

export interface PortEmailSendOptions {
  timeoutMs?: number;
  maxAttempts?: number;
}

export abstract class EmailServicePort {
  abstract send(message: PortEmailMessage, options?: PortEmailSendOptions): Promise<PortEmailResult>;
}

export abstract class ReservationServicePort {
  abstract create(...args: any[]): Promise<any>;
  abstract lockInventory(...args: any[]): Promise<any>;
  abstract modifyAcceptedStay(...args: any[]): Promise<any>;
}

export abstract class RatePlanServicePort {
  abstract assertSellable(...args: any[]): Promise<any> | any;
}

export abstract class GuestServicePort {
  abstract create(...args: any[]): Promise<any>;
}

export abstract class AncillaryServicePort {
  abstract attachToReservation(...args: any[]): Promise<any>;
  abstract ensurePackageComponents(...args: any[]): Promise<any> | any;
}

export abstract class AvailabilityServicePort {
  abstract searchAvailability(...args: any[]): Promise<any>;
}

export abstract class BookingEngineServicePort {
  abstract quote(...args: any[]): Promise<any>;
}

/**
 * Mirrors core `BookingEngineConfigService.getPublicConfig()`'s return shape.
 * `formQuestions` is `BookingFormQuestion[]` (not the broader
 * `BookingFormQuestionDefinition[]` union that also includes
 * `UnsupportedBookingFormQuestion`) because core's implementation filters
 * with `isSupportedQuestion` (a `question is BookingFormQuestion` type guard)
 * before ever returning the array — the public/booking-facing config never
 * publishes a question type this deployment cannot interpret.
 */
export interface PublicBookingEngineConfig {
  propertyId: string;
  isEnabled: boolean;
  displayName: string | null;
  logoMediaId: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  depositPolicy: DepositPolicy;
  stripePublishableKey: string | null;
  sellableRoomTypeIds: string[];
  sellableRatePlanIds: string[];
  bookingMode: BookingMode;
  paymentMethodCollection: PaymentMethodCollection;
  paymentMethodClientMode: 'mock' | 'stripe' | 'unsupported';
  formQuestions: BookingFormQuestion[];
}

export abstract class BookingEngineConfigServicePort {
  abstract getPublicConfig(
    propertyId: string,
    db?: unknown,
    lockForUpdate?: boolean,
  ): Promise<PublicBookingEngineConfig>;
}

/**
 * Guard ports. Core's `BookingKeyGuard` / `BookingEngineScopeGuard` /
 * `BookingThrottleGuard` (apps/api `auth`/`booking-engine` modules) are also
 * used by core's own `BookingEngineController`, so they stay in apps/api as
 * the single source of truth (rate-limit state, credential/scope checks) —
 * this package's public controller references these abstract-class tokens in
 * `@UseGuards(...)` and bootstrap binds them with `useExisting`.
 */
export abstract class BookingKeyGuardPort implements CanActivate {
  abstract canActivate(...args: any[]): boolean | Promise<boolean>;
}

export abstract class BookingEngineScopeGuardPort implements CanActivate {
  abstract canActivate(...args: any[]): boolean | Promise<boolean>;
}

export abstract class BookingThrottleGuardPort implements CanActivate {
  abstract canActivate(...args: any[]): boolean | Promise<boolean>;
}
