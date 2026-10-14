import { describe, expect, it } from 'vitest';
import { auditLogs, depositLedgerEntries, folios, payments, reservations } from '@telivityhaip/database';
import { finalizeHostedAuthorization } from './hosted-authorization-finalizer';

function tableName(table: unknown): string {
  if (table === payments) return 'payments';
  if (table === reservations) return 'reservations';
  if (table === folios) return 'folios';
  if (table === depositLedgerEntries) return 'deposits';
  if (table === auditLogs) return 'audit';
  return 'other';
}

function harness(options: {
  payment: Record<string, unknown> | null;
  reservation?: Record<string, unknown> | null;
  folio?: Record<string, unknown> | null;
}) {
  const writes: { table: string; values: Record<string, unknown> }[] = [];
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              writes.push({ table: tableName(table), values });
              const done = Promise.resolve(undefined);
              return Object.assign(done, {
                returning: async () => (table === payments && options.payment ? [options.payment] : []),
              });
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              const rows = table === reservations
                ? (options.reservation ? [options.reservation] : [])
                : table === folios
                  ? (options.folio ? [options.folio] : [])
                  : [];
              return Object.assign(Promise.resolve(rows), { for: async () => rows });
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserts.push({ table: tableName(table), values });
          const done = Promise.resolve(undefined);
          return Object.assign(done, {
            returning: async () => [{
              id: 'dep-1',
              amount: values.amount,
              status: values.status,
              isRefundable: values.isRefundable,
            }],
          });
        },
      };
    },
  };
  return {
    db: { transaction: (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx) },
    writes,
    inserts,
  };
}

const payment = {
  id: 'pay-1',
  folioId: 'folio-1',
  amount: '40.00',
  currencyCode: 'EUR',
  authorizationFinalization: {
    deposit: { reservationId: 'res-1', isRefundable: true, autoConfirm: false },
  },
};

describe('finalizeHostedAuthorization', () => {
  it('cancels a still-pending reservation on decline without a penalty deposit', async () => {
    const { db, writes, inserts } = harness({
      payment,
      reservation: { id: 'res-1', status: 'pending' },
    });
    const events = await finalizeHostedAuthorization(db, {
      paymentId: 'pay-1',
      propertyId: 'prop-1',
      gatewayProvider: 'worldline',
      success: false,
      cancelPendingReservation: true,
      failureReason: 'Hosted checkout was not authorized',
    });
    const reservationWrite = writes.find((write) => write.table === 'reservations');
    expect(reservationWrite?.values).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'Payment was not authorized',
    });
    expect(Object.keys(reservationWrite?.values ?? {}).sort()).toEqual([
      'cancellationReason',
      'cancelledAt',
      'status',
      'updatedAt',
    ]);
    expect(inserts.some((row) => row.table === 'deposits')).toBe(false);
    expect(events.map((event) => event.event)).toEqual(['payment.failed', 'reservation.cancelled']);
  });

  it('leaves a pending reservation in place when cancellation was not requested', async () => {
    const { db, writes } = harness({
      payment,
      reservation: { id: 'res-1', status: 'pending' },
    });
    const events = await finalizeHostedAuthorization(db, {
      paymentId: 'pay-1',
      propertyId: 'prop-1',
      gatewayProvider: 'redsys',
      success: false,
      failureReason: 'Ds_Response=0190',
    });
    expect(writes.some((write) => write.table === 'reservations')).toBe(false);
    expect(events.map((event) => event.event)).toEqual(['payment.failed']);
  });

  it('does not cancel a reservation that is already confirmed', async () => {
    const { db, writes } = harness({
      payment,
      reservation: { id: 'res-1', status: 'confirmed' },
    });
    const events = await finalizeHostedAuthorization(db, {
      paymentId: 'pay-1',
      propertyId: 'prop-1',
      gatewayProvider: 'worldline',
      success: false,
      cancelPendingReservation: true,
      failureReason: 'Hosted checkout was not authorized',
    });
    expect(writes.some((write) => write.table === 'reservations')).toBe(false);
    expect(events.map((event) => event.event)).toEqual(['payment.failed']);
  });

  it('stores a capture with processedAt and still records the deposit', async () => {
    const { db, writes, inserts } = harness({
      payment,
      folio: { id: 'folio-1', reservationId: 'res-1' },
      reservation: { id: 'res-1', status: 'pending' },
    });
    const events = await finalizeHostedAuthorization(db, {
      paymentId: 'pay-1',
      propertyId: 'prop-1',
      gatewayProvider: 'worldline',
      success: true,
      captured: true,
      failureReason: '',
    });
    expect(writes.find((write) => write.table === 'payments')?.values).toMatchObject({ status: 'captured' });
    expect(writes.find((write) => write.table === 'payments')?.values.processedAt).toBeInstanceOf(Date);
    expect(inserts.some((row) => row.table === 'deposits')).toBe(true);
    expect(events.map((event) => event.event)).toEqual(['payment.received', 'deposit.received']);
    expect(events[0]?.data).toMatchObject({ status: 'captured' });
  });
});
