import { Injectable } from '@nestjs/common';
import type { FiscalProviderAck } from '../fiscal-provider.interface';
import type {
  GuestRegistrationProvider,
  GuestRegistrationReportInput,
} from '../guest-registration-provider.interface';

@Injectable()
export class MockGuestRegistrationProvider implements GuestRegistrationProvider {
  readonly key = 'mock';
  readonly checkInCalls: GuestRegistrationReportInput[] = [];
  readonly checkOutCalls: GuestRegistrationReportInput[] = [];

  async reportCheckIn(input: GuestRegistrationReportInput): Promise<FiscalProviderAck> {
    this.checkInCalls.push(input);
    return {
      externalId: `mock-guest-check-in-${input.reservationId}`,
      rawAck: {
        accepted: true,
        providerKey: this.key,
        operation: 'check_in',
      },
    };
  }

  async reportCheckOut(input: GuestRegistrationReportInput): Promise<FiscalProviderAck> {
    this.checkOutCalls.push(input);
    return {
      externalId: `mock-guest-check-out-${input.reservationId}`,
      rawAck: {
        accepted: true,
        providerKey: this.key,
        operation: 'check_out',
      },
    };
  }

  reset() {
    this.checkInCalls.length = 0;
    this.checkOutCalls.length = 0;
  }
}
