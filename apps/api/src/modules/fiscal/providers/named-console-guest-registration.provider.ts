import { Injectable, Logger } from '@nestjs/common';
import type { FiscalProviderAck } from '../fiscal-provider.interface';
import type {
  GuestRegistrationProvider,
  GuestRegistrationReportInput,
} from '../guest-registration-provider.interface';

@Injectable()
export class NamedConsoleGuestRegistrationProvider implements GuestRegistrationProvider {
  private readonly logger: Logger;
  readonly calls: GuestRegistrationReportInput[] = [];

  constructor(
    readonly key: string,
    readonly label: string,
  ) {
    this.logger = new Logger(`GuestRegConsole:${key}`);
  }

  async reportCheckIn(input: GuestRegistrationReportInput): Promise<FiscalProviderAck> {
    return this.report(input);
  }

  async reportCheckOut(input: GuestRegistrationReportInput): Promise<FiscalProviderAck> {
    return this.report(input);
  }

  private async report(input: GuestRegistrationReportInput): Promise<FiscalProviderAck> {
    this.calls.push(input);
    const externalId = `${this.key}-${input.reservationId}-${input.sourceEvent}`;
    this.logger.log(
      `${this.label} console handoff (${input.sourceEvent}) reservation=${input.reservationId}`,
    );
    return {
      externalId,
      rawAck: {
        accepted: true,
        providerKey: this.key,
        mode: 'console',
        label: this.label,
      },
    };
  }

  reset() {
    this.calls.length = 0;
  }
}

/**
 * Wave 3 guest-registration country packs (6) plus id-checkin guest-reg providers
 * (Croatia eVisitor, Italy Alloggiati) that share the same interface.
 * Console until partner/KB authority clients land.
 */
export const WAVE_GUEST_REG_CONSOLE_PACKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'luxembourg_fiches', label: "Luxembourg fiches d'hébergement" },
  { key: 'portugal_siba', label: 'Portugal SIBA' },
  { key: 'andorra_roat', label: 'Andorra ROAT' },
  { key: 'czechia_ubyport', label: 'Czechia Ubyport' },
  { key: 'finland_matkustajailmoitus', label: 'Finland Matkustajailmoitus' },
  { key: 'uruguay_rihp', label: 'Uruguay RIHP' },
  { key: 'croatia_evisitor', label: 'Croatia eVisitor' },
  { key: 'italy_alloggiati', label: 'Italy Alloggiati Web' },
];
