import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditLogs, bookings, depositLedgerEntries, folios, guests, payments,
  properties, ratePlans, reservations, roomTypes,
} from '@telivityhaip/database';
import { WebhookService } from '../webhook/webhook.service';
import { RedsysWebhookController } from './redsys-webhook.controller';
import { BookingReturnService } from '../booking-engine/booking-return.service';
import { REDSYS_SANDBOX, REDSYS_SIGNATURE_VERSION, encodeMerchantParameters, signMerchantParameters } from './gateways/redsys-crypto';

// Opt-in PostgreSQL suite. Every fixture uses fresh IDs; cleanup only removes
// rows belonging to that fixture, never other users' or suites' records.
const databaseUrl = process.env['REDSYS_TEST_DATABASE_URL'];
describe.skipIf(!databaseUrl)('Redsys authoritative booking finalization', () => {
  const client = postgres(databaseUrl ?? 'postgresql://localhost/unavailable', { max: 5 });
  const db = drizzle(client);
  const events = new EventEmitter2();
  const webhook = new WebhookService(db, events);
  const credentials = { resolveForProperty: vi.fn(async () => ({ ...REDSYS_SANDBOX, environment: 'test' })) };
  const controller = new RedsysWebhookController(db, webhook, credentials as any);
  let propertyId: string;
  let guestId: string;
  let reservationId: string;
  let paymentId: string;
  let orderId: string;

  beforeEach(async () => {
    propertyId = randomUUID();
    guestId = randomUUID();
    reservationId = randomUUID();
    paymentId = randomUUID();
    orderId = `1234${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const roomTypeId = randomUUID();
    const ratePlanId = randomUUID();
    const bookingId = randomUUID();
    const folioId = randomUUID();
    await db.insert(properties).values({ id: propertyId, name: 'Payment test', code: propertyId.slice(0, 20), countryCode: 'ES', timezone: 'Europe/Madrid', currencyCode: 'EUR', totalRooms: 1 });
    await db.insert(guests).values({ id: guestId, firstName: 'Test', lastName: 'Guest' });
    await db.insert(roomTypes).values({ id: roomTypeId, propertyId, name: 'Test', code: 'TEST', maxOccupancy: 2, defaultOccupancy: 1 });
    await db.insert(ratePlans).values({ id: ratePlanId, propertyId, roomTypeId, name: 'Test', code: 'TEST', type: 'bar', baseAmount: '110.00', currencyCode: 'EUR' });
    await db.insert(bookings).values({ id: bookingId, propertyId, guestId, confirmationNumber: randomUUID(), source: 'direct', channelCode: 'booking_engine' });
    await db.insert(reservations).values({ id: reservationId, propertyId, bookingId, guestId, roomTypeId, ratePlanId, arrivalDate: '2027-01-01', departureDate: '2027-01-02', nights: 1, totalAmount: '110.00', currencyCode: 'EUR' });
    await db.insert(folios).values({ id: folioId, propertyId, reservationId, bookingId, guestId, folioNumber: randomUUID(), currencyCode: 'EUR' });
    await db.insert(payments).values({ id: paymentId, propertyId, folioId, method: 'credit_card', status: 'pending', amount: '110.00', currencyCode: 'EUR', isPreAuthorization: true, gatewayProvider: 'redsys', gatewayTransactionId: orderId,
      authorizationFinalization: { deposit: { reservationId, isRefundable: false, autoConfirm: true } },
    } as any);
  });

  afterEach(async () => {
    events.removeAllListeners();
    vi.restoreAllMocks();
    for (const table of [auditLogs, depositLedgerEntries, payments, folios, reservations, bookings, ratePlans, roomTypes]) {
      await db.delete(table).where(eq(table.propertyId, propertyId));
    }
    await db.delete(guests).where(eq(guests.id, guestId));
    await db.delete(properties).where(eq(properties.id, propertyId));
  });
  afterAll(async () => { await client.end(); });

  function notification(overrides: Record<string, string> = {}) {
    const encoded = encodeMerchantParameters({ Ds_Order: orderId, Ds_Response: '0000', Ds_Amount: '11000', Ds_Currency: '978', Ds_MerchantCode: REDSYS_SANDBOX.merchantCode, Ds_Terminal: '1', Ds_TransactionType: '1', ...overrides });
    return { body: { Ds_SignatureVersion: REDSYS_SIGNATURE_VERSION, Ds_MerchantParameters: encoded, Ds_Signature: signMerchantParameters(encoded, REDSYS_SANDBOX.secretKey, orderId) } };
  }
  async function notify(req = notification()) {
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
    await controller.handleNotification(req, res);
    return res.status.mock.calls[0]?.[0];
  }
  async function state() {
    const [payment] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    const [reservation] = await db.select().from(reservations).where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    const deposits = await db.select().from(depositLedgerEntries).where(eq(depositLedgerEntries.propertyId, propertyId));
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.propertyId, propertyId));
    return { payment, reservation, deposits, audits };
  }

  function returnService() {
    return new BookingReturnService(db, { get: (key: string) => ({
      BOOKING_RETURN_ORIGINS: 'https://hotel.example', PUBLIC_API_BASE_URL: 'https://api.example', NODE_ENV: 'production',
    })[key] } as any);
  }

  it('recovers payment state before and after the callback using only a scoped return capability', async () => {
    const returns = returnService();
    const destination = `https://hotel.example/stays/book?lang=es&context=${'a'.repeat(500)}#rooms`;
    const prepared = returns.prepare(propertyId, destination);
    const reference = new URL(prepared.url).pathname.split('/').at(-1)!;
    await db.update(payments).set({ bookingReturnReferenceHash: prepared.referenceHash, bookingReturnDestination: prepared.destination })
      .where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    const target = new URL(destination);
    target.searchParams.set('haip_payment_return', reference);
    expect(prepared.url.length).toBeLessThanOrEqual(250);
    expect(await returns.resolve(propertyId, reference)).toBe(target.href);
    await expect(returns.resolve(randomUUID(), reference)).rejects.toThrow('Payment return not found');
    await expect(returns.resolve(propertyId, 'z'.repeat(43))).rejects.toThrow('Payment return not found');
    expect(await returns.status(propertyId, reference)).toEqual({ status: 'processing' });
    await expect(returns.status(randomUUID(), reference)).rejects.toThrow('Payment return not found');
    await expect(returns.status(propertyId, 'z'.repeat(43))).rejects.toThrow('Payment return not found');
    await notify();
    expect(await returns.status(propertyId, reference)).toEqual({ status: 'succeeded' });
    expect(await returns.resolve(propertyId, reference)).toBe(target.href);
    expect((await state()).reservation?.status).toBe('confirmed');
  });

  it('keeps two valid capabilities bound to their own exact persisted targets', async () => {
    const returns = returnService();
    const first = returns.prepare(propertyId, 'https://hotel.example/stays/first?lang=es');
    const second = returns.prepare(propertyId, 'https://hotel.example/stays/second?lang=en');
    await db.update(payments).set({ bookingReturnReferenceHash: first.referenceHash, bookingReturnDestination: first.destination })
      .where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    const existing = (await state()).payment!;
    await db.insert(payments).values({ ...existing, id: randomUUID(), gatewayTransactionId: null,
      bookingReturnReferenceHash: second.referenceHash, bookingReturnDestination: second.destination });
    for (const prepared of [first, second]) {
      const reference = new URL(prepared.url).pathname.split('/').at(-1)!;
      const expected = new URL(prepared.destination);
      expected.searchParams.set('haip_payment_return', reference);
      expect(await returns.resolve(propertyId, reference)).toBe(expected.href);
    }
  });

  it.each(['0180', '9915'])('shows failure only after the signed decline/cancellation callback %s', async (response) => {
    const returns = returnService();
    const prepared = returns.prepare(propertyId, 'https://hotel.example/stays/book');
    const reference = new URL(prepared.url).pathname.split('/').at(-1)!;
    await db.update(payments).set({ bookingReturnReferenceHash: prepared.referenceHash, bookingReturnDestination: prepared.destination })
      .where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    expect(await returns.status(propertyId, reference)).toEqual({ status: 'processing' });
    await notify(notification({ Ds_Response: response }));
    expect(await returns.status(propertyId, reference)).toEqual({ status: 'failed' });
  });

  it('records the deposit and configured confirmation only after verified authorization', async () => {
    expect((await state()).deposits).toHaveLength(0);
    expect(await notify()).toBe(200);
    const result = await state();
    expect(result.payment?.status).toBe('authorized');
    expect(result.deposits).toMatchObject([{ paymentId, reservationId, amount: '110.00', status: 'held', isRefundable: false }]);
    expect(result.reservation?.status).toBe('confirmed');
    expect(result.audits.map((row) => (row.newValue as any).event).sort()).toEqual(['deposit.received', 'payment.received', 'reservation.confirmed']);
  });

  it('creates exactly one deposit and audit per event under simultaneous duplicate callbacks', async () => {
    await Promise.all([notify(), notify(), notify()]);
    await notify();
    const result = await state();
    expect(result.deposits).toHaveLength(1);
    expect(result.audits).toHaveLength(3);
    expect(result.reservation?.status).toBe('confirmed');
  });

  it('does not auto-confirm when the saved configuration disables it', async () => {
    await db.update(payments).set({ status: 'pending', authorizationFinalization: { deposit: { reservationId, isRefundable: true, autoConfirm: false } } } as any).where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    await notify();
    const result = await state();
    expect(result.deposits).toHaveLength(1);
    expect(result.reservation?.status).toBe('pending');
  });

  it('does not infer a deposit from a booking folio without a saved intent', async () => {
    await db.update(payments).set({ authorizationFinalization: null } as any)
      .where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    await notify();
    expect(await state()).toMatchObject({ payment: { status: 'authorized' }, reservation: { status: 'pending' }, deposits: [] });
  });

  it('rejects a deposit intent that does not belong to the payment folio', async () => {
    await db.update(payments).set({ authorizationFinalization: { deposit: { reservationId: randomUUID(), isRefundable: true, autoConfirm: true } } } as any)
      .where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    await expect(notify()).rejects.toThrow('Deposit reservation must match the payment folio');
    expect(await state()).toMatchObject({ payment: { status: 'pending' }, reservation: { status: 'pending' }, deposits: [], audits: [] });
  });

  it('does not revive a cancelled reservation when authorization arrives late', async () => {
    await db.update(reservations).set({ status: 'cancelled' })
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    await notify();
    expect((await state()).reservation?.status).toBe('cancelled');
  });

  it('publishes each event once after the complete state and audits have committed', async () => {
    const observed: Array<{ event: string; logicalEventId: string; status: string; deposits: number; audits: number }> = [];
    for (const event of ['payment.received', 'deposit.received', 'reservation.confirmed']) {
      events.on(event, async (payload) => {
        const result = await state();
        observed.push({ event, logicalEventId: payload.logicalEventId, status: result.reservation!.status, deposits: result.deposits.length, audits: result.audits.length });
      });
    }
    await Promise.all([notify(), notify()]);
    expect(observed).toHaveLength(3);
    for (const item of observed) {
      expect(item).toMatchObject({ status: 'confirmed', deposits: 1, audits: 3 });
      expect((await state()).audits.some((audit) => audit.id === item.logicalEventId)).toBe(true);
    }
  });

  it.each(['0190', '9915', '0400', '0900', '0000garbage'])('response %s cannot create a deposit or confirm', async (response) => {
    await notify(notification({ Ds_Response: response }));
    await notify(notification({ Ds_Response: response }));
    const result = await state();
    expect(result.payment?.status).toBe('failed');
    expect(result.deposits).toHaveLength(0);
    expect(result.reservation?.status).toBe('pending');
    expect(result.audits).toHaveLength(1);
  });

  it('rejects an invalid signature without any changes', async () => {
    const request = notification();
    request.body.Ds_Signature = 'invalid';
    expect(await notify(request)).toBe(400);
    expect(await state()).toMatchObject({ payment: { status: 'pending' }, reservation: { status: 'pending' }, deposits: [], audits: [] });
  });

  it('rejects an unsupported signature version', async () => {
    const request = notification();
    request.body.Ds_SignatureVersion = 'unsupported';
    expect(await notify(request)).toBe(400);
    expect(await state()).toMatchObject({ payment: { status: 'pending' }, deposits: [], audits: [] });
  });

  it('rolls back all financial changes when persistence fails, allowing a clean retry', async () => {
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementationOnce((run: any) => transaction(async (tx) => {
      const insert = tx.insert.bind(tx);
      tx.insert = ((table: any) => {
        if (table === auditLogs) throw new Error('simulated audit persistence failure');
        return insert(table);
      }) as any;
      return run(tx);
    }));
    await expect(notify()).rejects.toThrow('simulated audit persistence failure');
    expect(await state()).toMatchObject({ payment: { status: 'pending' }, reservation: { status: 'pending' }, deposits: [], audits: [] });
    expect(await notify()).toBe(200);
    expect((await state()).deposits).toHaveLength(1);
  });

  it.each([{ Ds_Amount: '1' }, { Ds_Currency: '840' }, { Ds_MerchantCode: 'other' }, { Ds_Terminal: '2' }, { Ds_TransactionType: '3' }])('rejects a signed notification that does not match the authorization: %j', async (override) => {
    expect(await notify(notification(override))).toBe(400);
    expect(await state()).toMatchObject({ payment: { status: 'pending' }, deposits: [], audits: [] });
  });
});
