export interface FiscalReportInput {
  propertyId: string;
  folioId: string;
  /** Present when the hook is driven by `invoice.requested`. */
  fiscalDocumentId?: string;
  documentType: string;
  sourceEvent: 'invoice.requested';
  folio?: {
    folioNumber?: string | null;
    balance?: string | null;
  };
  config?: Record<string, unknown>;
  eventData?: Record<string, unknown>;
}

export interface FiscalProviderAck {
  externalId: string;
  rawAck?: unknown;
}

export interface FiscalProvider {
  readonly key: string;
  signOrReport(input: FiscalReportInput): Promise<FiscalProviderAck>;
}

export const FISCAL_PROVIDERS = Symbol('FISCAL_PROVIDERS');
