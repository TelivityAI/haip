import type { FiscalProviderAck } from './fiscal-provider.interface';

export interface GuestRegistrationReportInput {
  propertyId: string;
  reservationId: string;
  guestId?: string | null;
  roomId?: string | null;
  sourceEvent: 'reservation.checked_in' | 'reservation.checked_out';
  config?: Record<string, unknown>;
  eventData?: Record<string, unknown>;
}

export interface GuestRegistrationProvider {
  readonly key: string;
  reportCheckIn(input: GuestRegistrationReportInput): Promise<FiscalProviderAck>;
  reportCheckOut(input: GuestRegistrationReportInput): Promise<FiscalProviderAck>;
}

export const GUEST_REGISTRATION_PROVIDERS = Symbol('GUEST_REGISTRATION_PROVIDERS');
