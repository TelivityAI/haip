import { Injectable } from '@nestjs/common';
import type {
  FiscalProvider,
  FiscalProviderAck,
  FiscalReportInput,
} from '../fiscal-provider.interface';

@Injectable()
export class MockFiscalProvider implements FiscalProvider {
  readonly key = 'mock';
  readonly calls: FiscalReportInput[] = [];

  async signOrReport(input: FiscalReportInput): Promise<FiscalProviderAck> {
    this.calls.push(input);
    return {
      externalId: `mock-fiscal-${input.folioId}`,
      rawAck: {
        accepted: true,
        providerKey: this.key,
      },
    };
  }

  reset() {
    this.calls.length = 0;
  }
}
