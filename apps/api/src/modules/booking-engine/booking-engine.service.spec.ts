import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BookingEngineService } from './booking-engine.service';

const PROP = 'aaaaaaaa-0000-4000-a000-000000000001';
const RT = 'rt000000-0000-4000-a000-000000000001';
const RP = 'rp000000-0000-4000-a000-000000000001';

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const config = {
    getPublicConfig: vi.fn().mockResolvedValue({
      propertyId: PROP,
      isEnabled: true,
      displayName: 'Demo Hotel',
      sellableRoomTypeIds: [RT],
      sellableRatePlanIds: [RP],
      depositPolicy: { type: 'first_night', refundable: true },
    }),
    getConfig: vi.fn().mockResolvedValue({ autoConfirm: false }),
  };
  const availability = {
    searchAvailability: vi.fn().mockResolvedValue([{ roomTypeId: RT, available: 5 }]),
  };
  const ratePlan = {
    calculateDerivedRate: vi.fn().mockResolvedValue({ effectiveRate: 100, currency: 'USD' }),
    assertSellable: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue({ id: RP, roomTypeId: RT, currencyCode: 'USD' }),
  };
  const tax = { calculateTaxes: vi.fn().mockResolvedValue([{ amount: '10.00' }]) };
  const guest = { create: vi.fn().mockResolvedValue({ id: 'guest-1' }) };
  const reservation = {
    create: vi.fn().mockResolvedValue({ id: 'res-1', bookingId: 'bk-1', status: 'pending' }),
    confirm: vi.fn().mockResolvedValue({ id: 'res-1', status: 'confirmed' }),
    cancel: vi.fn(),
  };
  const folio = { createAutoFolio: vi.fn().mockResolvedValue({ id: 'folio-1' }) };
  const payment = { authorizePayment: vi.fn().mockResolvedValue({ id: 'pay-1' }) };
  const deposit = { recordDeposit: vi.fn().mockResolvedValue({ id: 'dep-1', status: 'held' }) };
  const search = { search: vi.fn() };
  const bookingSvc = { verify: vi.fn() };

  const svc = new BookingEngineService(
    {} as any,
    search as any,
    bookingSvc as any,
    reservation as any,
    availability as any,
    ratePlan as any,
    tax as any,
    guest as any,
    folio as any,
    payment as any,
    deposit as any,
    config as any,
  );
  return { svc, config, availability, ratePlan, tax, guest, reservation, folio, payment, deposit };
}

const bookDto = {
  roomTypeId: RT,
  ratePlanId: RP,
  checkIn: '2026-07-01',
  checkOut: '2026-07-03', // 2 nights
  guestFirstName: 'Ada',
  guestLastName: 'Lovelace',
  guestEmail: 'ada@example.com',
  adults: 2,
  paymentToken: 'tok_visa',
};

describe('BookingEngineService.quote', () => {
  it('prices server-side with the real tax engine and computes the deposit', async () => {
    const { svc } = makeService();
    const q = await svc.quote(PROP, { roomTypeId: RT, ratePlanId: RP, checkIn: '2026-07-01', checkOut: '2026-07-03', adults: 2 });
    expect(q.nights).toBe(2);
    expect(q.roomTotal).toBe('200.00');
    expect(q.taxTotal).toBe('20.00');
    expect(q.grandTotal).toBe('220.00');
    // first_night policy → total / nights
    expect(q.depositDue).toBe('110.00');
  });
});

describe('BookingEngineService.book', () => {
  it('classifies the payment as a held deposit (KB §10.5)', async () => {
    const { svc, deposit, payment } = makeService();
    const res = await svc.book(PROP, bookDto as any);

    expect(payment.authorizePayment).toHaveBeenCalledOnce();
    expect(deposit.recordDeposit).toHaveBeenCalledOnce();
    const depArg = deposit.recordDeposit.mock.calls[0][0];
    expect(depArg).toMatchObject({
      propertyId: PROP,
      reservationId: 'res-1',
      paymentId: 'pay-1',
      amount: '110.00',
      isRefundable: true,
    });
    expect(res.deposit).toMatchObject({ paymentId: 'pay-1', amount: '110.00', status: 'held' });
  });

  it('creates the reservation via the canonical path as a direct booking', async () => {
    const { svc, reservation } = makeService();
    const res = await svc.book(PROP, bookDto as any);
    const [dto, opts] = reservation.create.mock.calls[0];
    expect(dto).toMatchObject({
      propertyId: PROP,
      source: 'direct',
      channelCode: 'booking_engine',
      totalAmount: '220.00', // server-computed, not client-supplied
    });
    expect(opts.confirmationNumber).toMatch(/^HAIP-/);
    expect(res.confirmationNumber).toMatch(/^HAIP-/);
  });

  it('leaves the reservation pending when autoConfirm is off', async () => {
    const { svc, reservation } = makeService();
    const res = await svc.book(PROP, bookDto as any);
    expect(reservation.confirm).not.toHaveBeenCalled();
    expect(res.status).toBe('pending');
  });

  it('auto-confirms a paid booking when configured', async () => {
    const { svc, config, reservation } = makeService();
    config.getConfig.mockResolvedValue({ autoConfirm: true });
    const res = await svc.book(PROP, bookDto as any);
    expect(reservation.confirm).toHaveBeenCalledOnce();
    expect(res.status).toBe('confirmed');
  });

  it('rejects a room type that is not publicly sellable', async () => {
    const { svc, config } = makeService();
    config.getPublicConfig.mockResolvedValue({
      isEnabled: true,
      sellableRoomTypeIds: [],
      sellableRatePlanIds: [RP],
      depositPolicy: { type: 'first_night', refundable: true },
    });
    await expect(svc.book(PROP, bookDto as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects booking when the engine is disabled', async () => {
    const { svc, config } = makeService();
    config.getPublicConfig.mockResolvedValue({
      isEnabled: false,
      sellableRoomTypeIds: [RT],
      sellableRatePlanIds: [RP],
      depositPolicy: { type: 'first_night', refundable: true },
    });
    await expect(svc.book(PROP, bookDto as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a payment token when a deposit is due', async () => {
    const { svc } = makeService();
    const { paymentToken, ...noToken } = bookDto as any;
    await expect(svc.book(PROP, noToken)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a rate plan that belongs to a different room type (price-tampering guard)', async () => {
    // Attacker pairs a pricey room type with a cheap room's rate plan. Both are
    // individually sellable, but the rate plan is bound to a DIFFERENT room type.
    const { svc, ratePlan } = makeService();
    ratePlan.findById.mockResolvedValue({ id: RP, roomTypeId: 'rt000000-0000-4000-a000-0000000000ff', currencyCode: 'USD' });
    await expect(svc.book(PROP, bookDto as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BookingEngineService.quote — rate/room pairing', () => {
  it('rejects a rate plan that does not belong to the requested room type', async () => {
    const { svc, ratePlan } = makeService();
    ratePlan.findById.mockResolvedValue({ id: RP, roomTypeId: 'rt000000-0000-4000-a000-0000000000ff', currencyCode: 'USD' });
    await expect(
      svc.quote(PROP, { roomTypeId: RT, ratePlanId: RP, checkIn: '2026-07-01', checkOut: '2026-07-03', adults: 2 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
