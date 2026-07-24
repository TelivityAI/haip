import { describe, expect, it } from 'vitest';
import { FiscalProviderFactory } from '../fiscal-provider.factory';
import {
  NamedConsoleFiscalProvider,
  WAVE_FISCAL_CONSOLE_PACKS,
} from './named-console-fiscal.provider';
import {
  NamedConsoleGuestRegistrationProvider,
  WAVE_GUEST_REG_CONSOLE_PACKS,
} from './named-console-guest-registration.provider';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const FOLIO_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const RESERVATION_ID = '33333333-3333-4333-8333-333333333333';

describe('WAVE_FISCAL_CONSOLE_PACKS', () => {
  it('includes fiskaly SIGN AT and 28 Wave 3 fiscal keys (Brazil excluded)', () => {
    const keys = WAVE_FISCAL_CONSOLE_PACKS.map((p) => p.key);
    expect(keys).toContain('fiskaly_sign_at');
    expect(keys.filter((k) => k !== 'fiskaly_sign_at')).toHaveLength(28);
    expect(keys.some((k) => k.includes('brazil') || k.includes('nfce') || k.includes('fnrh'))).toBe(
      false,
    );
  });
});

describe('NamedConsoleFiscalProvider', () => {
  it('logs a console handoff and returns a deterministic acknowledgement', async () => {
    const provider = new NamedConsoleFiscalProvider('fiskaly_sign_at', 'fiskaly SIGN AT (RKSV)');

    const ack = await provider.signOrReport({
      propertyId: PROPERTY_ID,
      folioId: FOLIO_ID,
      fiscalDocumentId: DOCUMENT_ID,
      documentType: 'fiskaly_sign_at',
      sourceEvent: 'invoice.requested',
    });

    expect(ack.externalId).toBe(`fiskaly_sign_at-${DOCUMENT_ID}`);
    expect(ack.rawAck).toMatchObject({
      accepted: true,
      providerKey: 'fiskaly_sign_at',
      mode: 'console',
    });
    expect(provider.calls).toHaveLength(1);
  });
});

describe('NamedConsoleGuestRegistrationProvider', () => {
  it('reports check-in and check-out console handoffs', async () => {
    const provider = new NamedConsoleGuestRegistrationProvider(
      'luxembourg_fiches',
      "Luxembourg fiches d'hébergement",
    );

    const checkIn = await provider.reportCheckIn({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      sourceEvent: 'reservation.checked_in',
    });
    const checkOut = await provider.reportCheckOut({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      sourceEvent: 'reservation.checked_out',
    });

    expect(checkIn.externalId).toBe(
      `luxembourg_fiches-${RESERVATION_ID}-reservation.checked_in`,
    );
    expect(checkOut.rawAck).toMatchObject({ mode: 'console', providerKey: 'luxembourg_fiches' });
    expect(provider.calls).toHaveLength(2);
  });
});

describe('FiscalProviderFactory with wave console packs', () => {
  it('resolves fiskaly AT and guest-reg console keys', () => {
    const fiscal = WAVE_FISCAL_CONSOLE_PACKS.map(
      (p) => new NamedConsoleFiscalProvider(p.key, p.label),
    );
    const guest = WAVE_GUEST_REG_CONSOLE_PACKS.map(
      (p) => new NamedConsoleGuestRegistrationProvider(p.key, p.label),
    );
    const factory = new FiscalProviderFactory(fiscal, guest);

    expect(factory.getFiscalProvider('fiskaly_sign_at')?.key).toBe('fiskaly_sign_at');
    expect(factory.getFiscalProvider('italy_sdi')?.key).toBe('italy_sdi');
    expect(factory.getGuestRegistrationProvider('portugal_siba')?.key).toBe('portugal_siba');
    expect(factory.getGuestRegistrationProvider('croatia_evisitor')?.key).toBe('croatia_evisitor');
    expect(factory.fiscalProviderKeys()).toHaveLength(WAVE_FISCAL_CONSOLE_PACKS.length);
    expect(factory.guestRegistrationProviderKeys()).toHaveLength(WAVE_GUEST_REG_CONSOLE_PACKS.length);
  });
});
