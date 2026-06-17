import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ExpediaInboundController } from './expedia-inbound.controller';

/**
 * Controller-level HMAC tests with AUTH_ENABLED=true. Complements the routing
 * tests in `expedia-inbound.controller.spec.ts` (which intentionally turn auth
 * off to focus on routing) and the util-level tests in `inbound-auth.util.spec.ts`.
 */

const connectionA = {
  id: 'conn-A',
  config: { hotelId: 'HOTEL_A', inboundAuth: { secret: 'expedia-shared-A' } },
};

describe('ExpediaInboundController — HMAC (AUTH_ENABLED=true)', () => {
  let inbound: any;
  let channel: any;
  let controller: ExpediaInboundController;

  beforeEach(() => {
    inbound = { processInboundReservation: vi.fn() };
    channel = { findByAdapterType: vi.fn() };
    const config = { get: vi.fn().mockReturnValue('true') } as any;
    controller = new ExpediaInboundController(inbound as any, channel as any, config);
  });

  it('isAuthorizedFor accepts a correct HMAC over the raw body', () => {
    const body = '<BookingNotification id="abc"/>';
    const sig = createHmac('sha256', 'expedia-shared-A').update(body).digest('hex');
    expect((controller as any).isAuthorizedFor(connectionA, sig, body)).toBe(true);
  });

  it("isAuthorizedFor accepts a 'sha256=' prefixed signature", () => {
    const body = '<BookingNotification id="abc"/>';
    const sig = `sha256=${createHmac('sha256', 'expedia-shared-A').update(body).digest('hex')}`;
    expect((controller as any).isAuthorizedFor(connectionA, sig, body)).toBe(true);
  });

  it('isAuthorizedFor rejects a tampered body', () => {
    const body = '<BookingNotification id="abc"/>';
    const sig = createHmac('sha256', 'expedia-shared-A').update(body).digest('hex');
    expect((controller as any).isAuthorizedFor(connectionA, sig, body + 'tamper')).toBe(false);
  });

  it("isAuthorizedFor rejects a signature signed with another tenant's secret", () => {
    const body = '<BookingNotification id="abc"/>';
    const otherSig = createHmac('sha256', 'expedia-shared-B').update(body).digest('hex');
    expect((controller as any).isAuthorizedFor(connectionA, otherSig, body)).toBe(false);
  });

  it('isAuthorizedFor fails closed when the connection has no stored secret', () => {
    const noSecretConn = { id: 'c', config: { hotelId: 'HOTEL_A' } };
    const body = '<BookingNotification id="abc"/>';
    const sig = createHmac('sha256', 'expedia-shared-A').update(body).digest('hex');
    expect((controller as any).isAuthorizedFor(noSecretConn, sig, body)).toBe(false);
  });

  it('AUTH_ENABLED=false bypasses (sandbox/demo parity)', () => {
    const offConfig = { get: vi.fn().mockReturnValue('false') } as any;
    const offCtrl = new ExpediaInboundController(inbound as any, channel as any, offConfig);
    expect((offCtrl as any).isAuthorizedFor(connectionA, undefined, '')).toBe(true);
  });
});
