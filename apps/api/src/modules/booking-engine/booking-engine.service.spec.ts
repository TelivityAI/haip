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
      bookingMode: 'instant',
      paymentMethodCollection: 'disabled',
      formQuestions: [],
    }),
    getConfig: vi.fn().mockResolvedValue({ autoConfirm: false }),
  };
  const availability = {
    searchAvailability: vi.fn().mockResolvedValue([
      { roomTypeId: RT, date: '2026-07-01', available: 5 },
      { roomTypeId: RT, date: '2026-07-02', available: 5 },
    ]),
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
  const ancillary = {
    findServiceById: vi.fn(),
    listServices: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 }),
    attachToReservation: vi.fn().mockResolvedValue({}),
    ensurePackageComponents: vi.fn().mockResolvedValue([]),
  };
  const policy = {
    getPolicySummary: vi.fn().mockResolvedValue({
      type: 'tiered',
      description: 'Free cancellation up to 24 hours before check-in. First night charge after.',
      freeCancelHoursBeforeArrival: 24,
    }),
    evaluateCancellation: vi.fn(),
  };

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
    ancillary as any,
    policy as any,
  );
  return { svc, config, availability, ratePlan, tax, guest, reservation, folio, payment, deposit, ancillary, policy };
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

  it('rejects a stay when any canonical night is absent or sold out', async () => {
    const { svc, availability } = makeService();
    availability.searchAvailability.mockResolvedValue([
      { roomTypeId: RT, date: '2026-07-01', available: 1 },
      { roomTypeId: RT, date: '2026-07-03', available: 1 },
    ]);

    await expect(svc.quote(PROP, {
      roomTypeId: RT,
      ratePlanId: RP,
      checkIn: '2026-07-01',
      checkOut: '2026-07-04',
      adults: 2,
    })).rejects.toThrow(/availability/i);
  });

  it('captures exact per-night service, tax, currency, and posting metadata', async () => {
    const { svc, ancillary, tax } = makeService();
    ancillary.findServiceById.mockResolvedValue({
      id: 'service-parking',
      code: 'PARK',
      name: 'Parking',
      price: '15.00',
      currencyCode: 'USD',
      chargeType: 'parking',
      postingRule: 'per_night',
      sellChannels: ['booking_engine'],
      isActive: true,
    });
    tax.calculateTaxes.mockImplementation(async (
      _amount: string,
      chargeType: string,
    ) => [{ amount: chargeType === 'room' ? '10.00' : '2.00' }]);

    const quote = await svc.quote(PROP, {
      roomTypeId: RT,
      ratePlanId: RP,
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
      serviceIds: ['service-parking'],
    });

    expect(quote.services[0]).toMatchObject({
      serviceId: 'service-parking',
      chargeType: 'parking',
      currencyCode: 'USD',
      postingRule: 'per_night',
      unitPrice: '15.00',
      quantity: 2,
      lineTotal: '30.00',
      taxTotal: '4.00',
      lineItems: [
        { date: '2026-07-01', amount: '15.00', tax: '2.00' },
        { date: '2026-07-02', amount: '15.00', tax: '2.00' },
      ],
    });
  });

  it('reads the complete authoritative quote through a caller transaction', async () => {
    const { svc, config, availability, ratePlan, tax, policy } = makeService();
    const tx = { marker: 'acceptance-transaction' };

    await svc.quote(PROP, {
      roomTypeId: RT,
      ratePlanId: RP,
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
    }, tx);

    expect(config.getPublicConfig).toHaveBeenCalledWith(PROP, tx);
    expect(ratePlan.findById).toHaveBeenCalledWith(RP, PROP, tx);
    expect(ratePlan.calculateDerivedRate).toHaveBeenCalledWith(
      RP,
      PROP,
      expect.any(Object),
      tx,
    );
    expect(availability.searchAvailability).toHaveBeenCalledWith(
      PROP,
      '2026-07-01',
      '2026-07-03',
      RT,
      tx,
    );
    expect(tax.calculateTaxes).toHaveBeenCalledWith(
      '100.00',
      'room',
      PROP,
      '2026-07-01',
      expect.any(Object),
      tx,
    );
    expect(policy.getPolicySummary).toHaveBeenCalledWith(PROP, RP, tx);
  });

  it('locks mutable config and rate inputs for an acceptance quote', async () => {
    const { svc, config, ratePlan } = makeService();
    const tx = { marker: 'locked-acceptance-transaction' };

    await svc.quote(PROP, {
      roomTypeId: RT,
      ratePlanId: RP,
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
    }, tx, { lockForUpdate: true });

    expect(config.getPublicConfig).toHaveBeenCalledWith(PROP, tx, true);
    expect(ratePlan.findById).toHaveBeenCalledWith(RP, PROP, tx, true);
    expect(ratePlan.calculateDerivedRate).toHaveBeenCalledWith(
      RP,
      PROP,
      expect.any(Object),
      tx,
      true,
    );
  });
});

describe('BookingEngineService.book', () => {
  it('classifies the payment as a held deposit', async () => {
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
      bookingMode: 'instant',
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

  it('rejects request mode before creating a guest, reservation, folio, or payment', async () => {
    const { svc, config, guest, reservation, folio, payment } = makeService();
    config.getPublicConfig.mockResolvedValue({
      isEnabled: true,
      bookingMode: 'request',
      paymentMethodCollection: 'disabled',
      formQuestions: [],
      sellableRoomTypeIds: [RT],
      sellableRatePlanIds: [RP],
      depositPolicy: { type: 'first_night', refundable: true },
    });

    await expect(svc.book(PROP, bookDto as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(guest.create).not.toHaveBeenCalled();
    expect(reservation.create).not.toHaveBeenCalled();
    expect(folio.createAutoFolio).not.toHaveBeenCalled();
    expect(payment.authorizePayment).not.toHaveBeenCalled();
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
