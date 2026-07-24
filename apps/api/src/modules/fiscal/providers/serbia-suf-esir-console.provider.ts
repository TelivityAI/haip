import { Injectable, Logger } from '@nestjs/common';
import type {
  FiscalProvider,
  FiscalProviderAck,
  FiscalReportInput,
} from '../fiscal-provider.interface';

/**
 * Console/demo adapter for the Serbia SUF/ESIR fiscalization pathway named in
 * the public integration catalog. Core does not implement tax authority APIs;
 * this provider logs the handoff payload and returns a deterministic mock id.
 */
@Injectable()
export class SerbiaSufEsirConsoleProvider implements FiscalProvider {
  readonly key = 'serbia_suf_esir';
  private readonly logger = new Logger(SerbiaSufEsirConsoleProvider.name);
  readonly calls: FiscalReportInput[] = [];

  async signOrReport(input: FiscalReportInput): Promise<FiscalProviderAck> {
    this.calls.push(input);
    const externalId = `serbia-suf-esir-${input.fiscalDocumentId ?? input.folioId}`;
    this.logger.log(
      `Serbia SUF/ESIR console handoff (${input.sourceEvent}) folio=${input.folioId} doc=${input.fiscalDocumentId ?? 'n/a'}`,
    );
    return {
      externalId,
      rawAck: {
        accepted: true,
        providerKey: this.key,
        mode: 'console',
      },
    };
  }

  reset() {
    this.calls.length = 0;
  }
}
