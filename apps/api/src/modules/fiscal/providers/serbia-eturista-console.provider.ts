import { Injectable, Logger } from '@nestjs/common';
import type { FiscalProviderAck } from '../fiscal-provider.interface';
import type {
  GuestRegistrationProvider,
  GuestRegistrationReportInput,
} from '../guest-registration-provider.interface';

/**
 * Console/demo adapter for the Serbia eTurista guest-registration pathway named
 * in the public integration catalog. Core does not call government APIs here.
 */
@Injectable()
export class SerbiaEturistaConsoleProvider implements GuestRegistrationProvider {
  readonly key = 'serbia_eturista';
  private readonly logger = new Logger(SerbiaEturistaConsoleProvider.name);
  readonly checkInCalls: GuestRegistrationReportInput[] = [];
  readonly checkOutCalls: GuestRegistrationReportInput[] = [];

  async reportCheckIn(input: GuestRegistrationReportInput): Promise<FiscalProviderAck> {
    this.checkInCalls.push(input);
    this.logger.log(
      `Serbia eTurista console check-in reservation=${input.reservationId} property=${input.propertyId}`,
    );
    return {
      externalId: `serbia-eturista-check-in-${input.reservationId}`,
      rawAck: {
        accepted: true,
        providerKey: this.key,
        operation: 'check_in',
        mode: 'console',
      },
    };
  }

  async reportCheckOut(input: GuestRegistrationReportInput): Promise<FiscalProviderAck> {
    this.checkOutCalls.push(input);
    this.logger.log(
      `Serbia eTurista console check-out reservation=${input.reservationId} property=${input.propertyId}`,
    );
    return {
      externalId: `serbia-eturista-check-out-${input.reservationId}`,
      rawAck: {
        accepted: true,
        providerKey: this.key,
        operation: 'check_out',
        mode: 'console',
      },
    };
  }

  reset() {
    this.checkInCalls.length = 0;
    this.checkOutCalls.length = 0;
  }
}
