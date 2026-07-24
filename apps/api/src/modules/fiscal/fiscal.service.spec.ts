import { describe, expect, it, vi } from 'vitest';
import { FiscalProviderFactory } from './fiscal-provider.factory';
import { FiscalService } from './fiscal.service';
import { MockFiscalProvider } from './providers/mock-fiscal.provider';
import { MockGuestRegistrationProvider } from './providers/mock-guest-registration.provider';
import { SerbiaEturistaConsoleProvider } from './providers/serbia-eturista-console.provider';
import { SerbiaSufEsirConsoleProvider } from './providers/serbia-suf-esir-console.provider';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const FOLIO_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';

function createService(
  db: any,
  fiscalDocumentService: { issue: ReturnType<typeof vi.fn> },
  mock = new MockFiscalProvider(),
) {
  const guestMock = new MockGuestRegistrationProvider();
  const factory = new FiscalProviderFactory([mock], [guestMock]);
  return {
    service: new FiscalService(db, factory, fiscalDocumentService as any),
    mock,
    guestMock,
    fiscalDocumentService,
  };
}

function createDb(selectResults: any[][]) {
  const where = vi.fn().mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
  const inserts: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where,
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return {
          returning: vi.fn().mockResolvedValue([{ id: 'doc-1', ...value }]),
        };
      }),
    })),
  };
  return { db, where, inserts };
}

function deepContains(value: unknown, needle: string): boolean {
  const seen = new Set<unknown>();
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'string' && current.includes(needle)) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    stack.push(...Object.values(current));
  }
  return false;
}

describe('FiscalProviderFactory', () => {
  it('selects registered fiscal and guest-registration providers by key', () => {
    const factory = new FiscalProviderFactory(
      [new MockFiscalProvider(), new SerbiaSufEsirConsoleProvider()],
      [new MockGuestRegistrationProvider(), new SerbiaEturistaConsoleProvider()],
    );

    expect(factory.getFiscalProvider('mock')?.key).toBe('mock');
    expect(factory.getFiscalProvider('serbia_suf_esir')?.key).toBe('serbia_suf_esir');
    expect(factory.getGuestRegistrationProvider('serbia_eturista')?.key).toBe('serbia_eturista');
    expect(factory.getFiscalProvider('unknown')).toBeUndefined();
    expect(factory.fiscalProviderKeys()).toEqual(['mock', 'serbia_suf_esir']);
    expect(factory.guestRegistrationProviderKeys()).toEqual(['mock', 'serbia_eturista']);
  });
});

describe('MockFiscalProvider', () => {
  it('records sign/report calls and returns a mock acknowledgement', async () => {
    const provider = new MockFiscalProvider();

    const ack = await provider.signOrReport({
      propertyId: PROPERTY_ID,
      folioId: FOLIO_ID,
      fiscalDocumentId: DOCUMENT_ID,
      documentType: 'mock',
      sourceEvent: 'invoice.requested',
    });

    expect(ack.externalId).toBe(`mock-fiscal-${FOLIO_ID}`);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      propertyId: PROPERTY_ID,
      folioId: FOLIO_ID,
      sourceEvent: 'invoice.requested',
    });
  });
});

describe('MockGuestRegistrationProvider', () => {
  it('records check-in and check-out reports', async () => {
    const provider = new MockGuestRegistrationProvider();

    await provider.reportCheckIn({
      propertyId: PROPERTY_ID,
      reservationId: '33333333-3333-4333-8333-333333333333',
      sourceEvent: 'reservation.checked_in',
    });
    await provider.reportCheckOut({
      propertyId: PROPERTY_ID,
      reservationId: '33333333-3333-4333-8333-333333333333',
      sourceEvent: 'reservation.checked_out',
    });

    expect(provider.checkInCalls).toHaveLength(1);
    expect(provider.checkOutCalls).toHaveLength(1);
  });
});

describe('FiscalService', () => {
  it('skips invoice.requested when no fiscal provider is configured', async () => {
    const issue = vi.fn();
    const { db } = createDb([[{ id: PROPERTY_ID, settings: {} }]]);
    const { service, mock } = createService(db, { issue });

    const result = await service.processInvoiceRequested(PROPERTY_ID, DOCUMENT_ID, {
      folioId: FOLIO_ID,
    });

    expect(result).toMatchObject({ skipped: true, reason: 'no_fiscal_provider' });
    expect(mock.calls).toHaveLength(0);
    expect(issue).not.toHaveBeenCalled();
  });

  it('issues the fiscal document through FiscalDocumentService when configured', async () => {
    const issue = vi.fn().mockResolvedValue({
      id: DOCUMENT_ID,
      status: 'issued',
      documentNumber: `mock-fiscal-${FOLIO_ID}`,
    });
    const { db, inserts } = createDb([
      [
        {
          id: PROPERTY_ID,
          settings: {
            fiscal: {
              providerKey: 'mock',
              documentType: 'mock',
            },
          },
        },
      ],
    ]);
    const { service, mock } = createService(db, { issue });

    const result = await service.processInvoiceRequested(PROPERTY_ID, DOCUMENT_ID, {
      folioId: FOLIO_ID,
      documentType: 'mock',
    });

    expect(result).toMatchObject({ skipped: false });
    expect(mock.calls).toHaveLength(1);
    expect(issue).toHaveBeenCalledWith(FOLIO_ID, DOCUMENT_ID, {
      propertyId: PROPERTY_ID,
      documentNumber: `mock-fiscal-${FOLIO_ID}`,
      metadata: expect.objectContaining({ providerKey: 'mock' }),
    });
    expect(inserts[0]?.value).toMatchObject({
      propertyId: PROPERTY_ID,
      entityType: 'fiscal_document',
      entityId: DOCUMENT_ID,
    });
  });

  it('scopes guest-registration reports to the property reservation', async () => {
    const issue = vi.fn();
    const reservationId = '33333333-3333-4333-8333-333333333333';
    const { db, where } = createDb([
      [
        {
          id: PROPERTY_ID,
          settings: {
            guestRegistration: { providerKey: 'mock' },
          },
        },
      ],
      [{ id: reservationId, propertyId: PROPERTY_ID, guestId: 'guest-1', roomId: 'room-1' }],
    ]);
    const { service, guestMock } = createService(db, { issue });

    const result = await service.reportReservationCheckIn(PROPERTY_ID, reservationId);

    expect(result).toMatchObject({ skipped: false });
    expect(guestMock.checkInCalls).toHaveLength(1);
    const reservationWhere = where.mock.calls[1]?.[0];
    expect(deepContains(reservationWhere, 'property_id')).toBe(true);
  });

  it('skips guest registration when reservation is outside the tenant', async () => {
    const issue = vi.fn();
    const reservationId = '33333333-3333-4333-8333-333333333333';
    const { db } = createDb([
      [
        {
          id: PROPERTY_ID,
          settings: {
            guestRegistration: { providerKey: 'mock' },
          },
        },
      ],
      [],
    ]);
    const { service, guestMock } = createService(db, { issue });

    const result = await service.reportReservationCheckIn(PROPERTY_ID, reservationId);

    expect(result).toMatchObject({ skipped: true, reason: 'reservation_not_found' });
    expect(guestMock.checkInCalls).toHaveLength(0);
  });
});
