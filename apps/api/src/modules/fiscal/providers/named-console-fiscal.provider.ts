import { Injectable, Logger } from '@nestjs/common';
import type {
  FiscalProvider,
  FiscalProviderAck,
  FiscalReportInput,
} from '../fiscal-provider.interface';

/**
 * Console/demo fiscal adapters for catalog country packs.
 * Core does not call tax-authority APIs — production packs replace these
 * with KB-driven clients once credentials and partner docs exist.
 */
@Injectable()
export class NamedConsoleFiscalProvider implements FiscalProvider {
  private readonly logger: Logger;
  readonly calls: FiscalReportInput[] = [];

  constructor(
    readonly key: string,
    readonly label: string,
  ) {
    this.logger = new Logger(`FiscalConsole:${key}`);
  }

  async signOrReport(input: FiscalReportInput): Promise<FiscalProviderAck> {
    this.calls.push(input);
    const externalId = `${this.key}-${input.fiscalDocumentId ?? input.folioId}`;
    this.logger.log(
      `${this.label} console handoff (${input.sourceEvent}) folio=${input.folioId} doc=${input.fiscalDocumentId ?? 'n/a'}`,
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
 * Wave 2 leftover (`fiskaly_sign_at`) + Wave 3 fiscalization console packs (28).
 * Brazil fiscalization is excluded (local contributor).
 */
export const WAVE_FISCAL_CONSOLE_PACKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'fiskaly_sign_at', label: 'fiskaly SIGN AT (RKSV)' },
  { key: 'fiskaly_sign_de', label: 'fiskaly SIGN DE (TSE)' },
  { key: 'croatia_fiskalizacija_2', label: 'Croatia Fiskalizacija 2.0' },
  { key: 'slovenia_furs', label: 'Slovenia FURS' },
  { key: 'vies', label: 'VIES EU VAT validation' },
  { key: 'nbs_exchange_rates', label: 'NBS exchange rates' },
  { key: 'north_macedonia_efaktura', label: 'North Macedonia e-Faktura' },
  { key: 'bih_fiscalization', label: 'BiH fiscalization' },
  { key: 'montenegro_fiskalizacija', label: 'Montenegro Fiskalizacija' },
  { key: 'belgium_peppol_b2b', label: 'Belgium Peppol B2B' },
  { key: 'luxembourg_peppol', label: 'Luxembourg Peppol e-invoicing' },
  { key: 'ireland_vat_modernisation', label: 'Ireland VAT Modernisation' },
  { key: 'uk_mtd_vat', label: 'UK MTD VAT' },
  { key: 'swiss_qr_bill', label: 'Swiss QR-bill' },
  { key: 'italy_sdi', label: 'Italy SDI' },
  { key: 'spain_verifactu', label: 'Spain VeriFactu' },
  { key: 'spain_ticketbai', label: 'Spain TicketBAI' },
  { key: 'spain_sii', label: 'Spain SII' },
  { key: 'greece_mydata', label: 'Greece myDATA' },
  { key: 'estonia_einvoicing', label: 'Estonia e-invoicing' },
  { key: 'latvia_vid', label: 'Latvia VID' },
  { key: 'poland_ksef', label: 'Poland KSeF' },
  { key: 'hungary_nav_3', label: 'Hungary NAV 3.0' },
  { key: 'hungary_ntak', label: 'Hungary NTAK' },
  { key: 'romania_ro_efactura', label: 'Romania RO e-Factura' },
  { key: 'mexico_cfdi', label: 'Mexico CFDI' },
  { key: 'el_salvador_dte', label: 'El Salvador DTE' },
  { key: 'colombia_dian', label: 'Colombia DIAN' },
  { key: 'ecuador_sri', label: 'Ecuador SRI' },
];
