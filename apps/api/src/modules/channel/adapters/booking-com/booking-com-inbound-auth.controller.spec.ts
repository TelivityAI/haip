import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookingComInboundController } from './booking-com-inbound.controller';

/**
 * Controller-level Basic-Auth tests (Codex flagged that Expedia tests ran with
 * AUTH_ENABLED=false and Booking.com had no controller-level auth tests at all).
 * These exercise the actual `isAuthorizedFor` path with AUTH_ENABLED=true.
 */

function res() {
  const r: any = { status: vi.fn(), set: vi.fn(), send: vi.fn() };
  r.status.mockReturnValue(r);
  r.set.mockReturnValue(r);
  r.send.mockReturnValue(r);
  return r;
}

function makeReq(authHeader: string | undefined, rawBody = '<x/>') {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers['authorization'] = authHeader;
  return { headers, rawBody };
}

const connectionA = {
  id: 'conn-A',
  config: { hotelId: 'HOTEL_A', inboundAuth: { username: 'bc_user', password: 'bc_pass' } },
};

const goodAuth = `Basic ${Buffer.from('bc_user:bc_pass').toString('base64')}`;
const wrongAuth = `Basic ${Buffer.from('bc_user:wrong').toString('base64')}`;

describe('BookingComInboundController — Basic Auth (AUTH_ENABLED=true)', () => {
  let inboundResv: any;
  let channel: any;
  let controller: BookingComInboundController;

  beforeEach(() => {
    inboundResv = { processInboundReservation: vi.fn().mockResolvedValue({ confirmationNumber: 'PMS1' }) };
    channel = { findByAdapterType: vi.fn().mockResolvedValue([connectionA]) };
    const config = { get: vi.fn().mockReturnValue('true') } as any;
    controller = new BookingComInboundController(inboundResv as any, channel as any, config);
  });

  it('isAuthorizedFor returns true with the correct Basic-Auth header', () => {
    expect((controller as any).isAuthorizedFor(connectionA, goodAuth)).toBe(true);
  });

  it('isAuthorizedFor returns false with a wrong password', () => {
    expect((controller as any).isAuthorizedFor(connectionA, wrongAuth)).toBe(false);
  });

  it('isAuthorizedFor returns false when the Authorization header is missing', () => {
    expect((controller as any).isAuthorizedFor(connectionA, undefined)).toBe(false);
  });

  it('isAuthorizedFor returns false when the connection has no stored inboundAuth (fail closed)', () => {
    const noAuthConn = { id: 'c', config: { hotelId: 'HOTEL_A' } };
    expect((controller as any).isAuthorizedFor(noAuthConn, goodAuth)).toBe(false);
  });

  it('isAuthorizedFor returns false when Basic auth was tampered with (sha256 of decoded mismatch)', () => {
    const longPad = `Basic ${Buffer.from('bc_user:bc_pass_with_extra_bytes_to_test_length').toString('base64')}`;
    expect((controller as any).isAuthorizedFor(connectionA, longPad)).toBe(false);
  });

  it('AUTH_ENABLED=false bypasses (sandbox/demo parity)', () => {
    const offConfig = { get: vi.fn().mockReturnValue('false') } as any;
    const offCtrl = new BookingComInboundController(inboundResv as any, channel as any, offConfig);
    expect((offCtrl as any).isAuthorizedFor(connectionA, undefined)).toBe(true);
  });
});
