import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  auditLogs,
  bookingRequestEmailDeliveries,
  bookingRequests,
} from './booking-request-db.js';
import { WEBHOOK_EVENTS } from '@telivityhaip/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditActor } from '../../common/audit/audit-actor';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { BookingRequestController } from './booking-request.controller';
import {
  acceptedBookingRequestEmail,
  deniedBookingRequestEmail,
  failedBookingRequestPaymentEmail,
  paymentReceivedBookingRequestEmail,
  refundedBookingRequestPaymentEmail,
  requestReceivedEmail,
} from './booking-request-email.templates';
import { BookingRequestMailerService } from './booking-request-mailer.service';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const OTHER_PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000002';
const REQUEST_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
const DELIVERY_ID = 'cccccccc-0000-4000-a000-000000000001';

type Delivery = typeof bookingRequestEmailDeliveries.$inferSelect;

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  const now = new Date('2026-08-25T00:00:00.000Z');
  return {
    id: DELIVERY_ID,
    propertyId: PROPERTY_ID,
    bookingRequestId: REQUEST_ID,
    logicalKey: 'request:receipt',
    kind: 'receipt',
    status: 'pending',
    recipient: 'guest@example.com',
    subject: 'We received your booking request',
    bodyText: 'Hello Ada. We received your booking request.',
    errorMessage: null,
    attempts: 0,
    automaticAttempts: 0,
    claimedAt: null,
    nextAttemptAt: now,
    lastAttemptAt: null,
    providerMessageId: null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

type HarnessOptions = {
  failAuditDescription?: string;
  failAuditTimes?: number;
  casWinner?: Delivery;
};

function createHarness(seed: Delivery[] = [], options: HarnessOptions = {}) {
  const state = {
    requests: [{ id: REQUEST_ID, propertyId: PROPERTY_ID }],
    deliveries: seed.map((row) => ({ ...row })),
    audits: [] as Array<Record<string, unknown>>,
    deliveryUpdates: [] as Array<Record<string, unknown>>,
  };
  let remainingAuditFailures = options.failAuditTimes ?? 0;

  const insert = vi.fn((table: unknown) => ({
    values: (values: Record<string, any>) => {
      if (table === auditLogs) {
        if (
          remainingAuditFailures > 0
          && values.description === options.failAuditDescription
        ) {
          remainingAuditFailures -= 1;
          throw new Error('audit write failed');
        }
        state.audits.push({ ...values });
        return Promise.resolve();
      }
      if (table !== bookingRequestEmailDeliveries) throw new Error('unexpected insert');
      const existing = state.deliveries.find((row) =>
        row.propertyId === values.propertyId
        && row.bookingRequestId === values.bookingRequestId
        && row.logicalKey === values.logicalKey);
      const created = existing ? undefined : delivery({
        ...values,
        id: values.id ?? DELIVERY_ID,
        status: values.status ?? 'pending',
        attempts: values.attempts ?? 0,
      });
      if (created) state.deliveries.push(created);
      const result = existing ? [] : [created!];
      return {
        onConflictDoNothing: () => ({ returning: async () => result }),
        returning: async () => result,
      };
    },
  }));

  const select = vi.fn(() => ({
    from: (table: unknown) => {
      const rows = table === bookingRequests ? state.requests : state.deliveries;
      const query: any = {
        where: () => query,
        orderBy: () => query,
        limit: async () => rows,
        for: async () => rows,
        then: (resolve: (value: any) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return query;
    },
  }));

  const conditionContains = (condition: unknown, value: string): boolean => {
    const seen = new WeakSet<object>();
    const visit = (candidate: unknown): boolean => {
      if (candidate === value) return true;
      if (!candidate || typeof candidate !== 'object') return false;
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      return Object.values(candidate).some(visit);
    };
    return visit(condition);
  };
  const update = vi.fn((table: unknown) => ({
    set: (changes: Record<string, any>) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          if (table !== bookingRequestEmailDeliveries) return [];
          const current = state.deliveries.find((row) => conditionContains(condition, row.id));
          if (!current) return [];
          if (
            options.casWinner
            && Object.hasOwn(changes, 'providerMessageId')
            && current.status === 'processing'
          ) {
            Object.assign(current, options.casWinner);
            return [];
          }
          state.deliveryUpdates.push({ ...changes });
          Object.assign(current, changes);
          return [current];
        },
        then: (resolve: (value: any) => unknown) => {
          const current = state.deliveries.find((row) => conditionContains(condition, row.id));
          if (table === bookingRequestEmailDeliveries && current) {
            state.deliveryUpdates.push({ ...changes });
            Object.assign(current, changes);
          }
          return Promise.resolve(undefined).then(resolve);
        },
      }),
    }),
  }));

  const db: any = {
    insert,
    select,
    update,
    transaction: async (work: (tx: any) => unknown) => {
      const deliveriesBefore = structuredClone(state.deliveries);
      const auditsBefore = structuredClone(state.audits);
      const deliveryUpdatesBefore = structuredClone(state.deliveryUpdates);
      try {
        return await work(db);
      } catch (error) {
        state.deliveries.splice(0, state.deliveries.length, ...deliveriesBefore);
        state.audits.splice(0, state.audits.length, ...auditsBefore);
        state.deliveryUpdates.splice(
          0,
          state.deliveryUpdates.length,
          ...deliveryUpdatesBefore,
        );
        throw error;
      }
    },
  };
  const emailService = { send: vi.fn() };
  const service = new BookingRequestMailerService(db, emailService as any);
  return { state, emailService, service };
}

describe('Booking Request email templates', () => {
  const common = {
    guestFirstName: 'Ada',
    arrivalDate: '2026-09-10',
    departureDate: '2026-09-12',
  };

  it('renders receipt, accepted, and denied messages without private links or identifiers', () => {
    const messages = [
      requestReceivedEmail(common),
      acceptedBookingRequestEmail({ ...common, acceptedTotal: '420.00', currencyCode: 'EUR' }),
      deniedBookingRequestEmail(common),
    ];

    for (const message of messages) {
      const content = `${message.subject}\n${message.bodyText}`;
      expect(content).toContain('Ada');
      expect(content).not.toMatch(/https?:\/\//i);
      expect(content).not.toMatch(/manage|cancel|sign[ -]?in|token|setupintent|paymentmethod|customer_/i);
      expect(content).not.toContain(REQUEST_ID);
    }
  });

  it('renders captured, refunded/returned, and failed payment messages with guest-safe facts only', () => {
    const messages = [
      paymentReceivedBookingRequestEmail({
        guestFirstName: 'Ada', amount: '100.00', currencyCode: 'EUR', source: 'external',
      }),
      refundedBookingRequestPaymentEmail({
        guestFirstName: 'Ada', amount: '40.00', currencyCode: 'EUR', source: 'external_return',
      }),
      failedBookingRequestPaymentEmail({
        guestFirstName: 'Ada', amount: '25.00', currencyCode: 'EUR', operation: 'charge',
      }),
    ];

    expect(messages[0].bodyText).toContain('100.00 EUR');
    expect(messages[1].bodyText).toContain('40.00 EUR');
    for (const message of messages) {
      const content = `${message.subject}\n${message.bodyText}`;
      expect(content).not.toMatch(/https?:\/\//i);
      expect(content).not.toMatch(/reference|provider|authentication|stripe|secret|token/i);
    }
  });
});

describe('BookingRequestMailerService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('persists one pending delivery per stable logical action before sending', async () => {
    const h = createHarness();
    h.emailService.send.mockImplementation(async () => {
      expect(h.state.deliveries[0]).toMatchObject({
        status: 'processing', attempts: 1, automaticAttempts: 1,
      });
      return { sent: true, provider: 'smtp', messageId: 'provider-message-id' };
    });
    const input = {
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      logicalKey: 'request:receipt',
      kind: 'receipt' as const,
      recipient: 'guest@example.com',
      subject: 'We received your booking request',
      bodyText: 'Hello Ada. We received your booking request.',
    };

    const firstId = await h.service.queue(input);
    const replayId = await h.service.queue(input);
    expect(firstId).toBe(DELIVERY_ID);
    expect(replayId).toBe(DELIVERY_ID);
    expect(h.state.deliveries).toHaveLength(1);

    const result = await h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID);
    expect(result).toMatchObject({
      status: 'sent', attempts: 1, errorMessage: null, providerMessageId: 'provider-message-id',
    });
    expect(h.emailService.send).toHaveBeenCalledOnce();
    const message = h.emailService.send.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      idempotencyKey: `booking-request-email:${DELIVERY_ID}`,
      messageId: `<booking-request-email-${DELIVERY_ID}@haip.local>`,
    });
  });

  it('schedules a safe bounded-backoff failure without exposing provider errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
    const h = createHarness([delivery({ nextAttemptAt: new Date(0) })]);
    h.emailService.send.mockRejectedValue(
      new Error('smtp password secret-token and pm_123 leaked'),
    );

    const failed = await h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID);
    expect(failed).toMatchObject({
      status: 'pending',
      attempts: 1,
      automaticAttempts: 1,
      errorMessage: 'Email transport failed',
      nextAttemptAt: new Date('2026-08-25T00:00:30.000Z'),
    });
    expect(failed?.errorMessage).not.toMatch(/secret|pm_123|password/i);
    expect(await h.service.processPendingDeliveries()).toBe(0);
    expect(h.emailService.send).toHaveBeenCalledOnce();
  });

  it('lists and retries only within the supplied property and request scope', async () => {
    const h = createHarness([
      delivery(),
      delivery({
        id: 'cccccccc-0000-4000-a000-000000000002',
        propertyId: OTHER_PROPERTY_ID,
      }),
    ]);

    await expect(h.service.listForRequest(REQUEST_ID, OTHER_PROPERTY_ID))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.retry(DELIVERY_ID, REQUEST_ID, OTHER_PROPERTY_ID, {}))
      .rejects.toBeInstanceOf(NotFoundException);
    const own = await h.service.listForRequest(REQUEST_ID, PROPERTY_ID);
    expect(own).toHaveLength(1);
    expect(own[0]).toEqual({
      id: DELIVERY_ID,
      kind: 'receipt',
      status: 'pending',
      subject: 'We received your booking request',
      bodyText: 'Hello Ada. We received your booking request.',
      errorMessage: null,
      attempts: 0,
      nextAttemptAt: new Date('2026-08-25T00:00:00.000Z'),
      lastAttemptAt: null,
      sentAt: null,
      createdAt: new Date('2026-08-25T00:00:00.000Z'),
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    });
    expect(own[0]).not.toHaveProperty('logicalKey');
    expect(own[0]).not.toHaveProperty('propertyId');
    expect(own[0]).not.toHaveProperty('bookingRequestId');
    expect(own[0]).not.toHaveProperty('claimedAt');
    expect(own[0]).not.toHaveProperty('providerMessageId');
  });

  it('recovers only due pending and stale processing deliveries, never terminal failures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:10:00.000Z'));
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const future = new Date(Date.now() + 60_000);
    const h = createHarness([
      delivery(),
      delivery({
        id: 'cccccccc-0000-4000-a000-000000000002',
        status: 'processing',
        claimedAt: stale,
        nextAttemptAt: stale,
        attempts: 1,
        automaticAttempts: 1,
      }),
      delivery({
        id: 'cccccccc-0000-4000-a000-000000000003', status: 'pending', nextAttemptAt: future,
      }),
      delivery({ id: 'cccccccc-0000-4000-a000-000000000004', status: 'failed' }),
      delivery({ id: 'cccccccc-0000-4000-a000-000000000005', status: 'sent' }),
      delivery({
        id: 'cccccccc-0000-4000-a000-000000000006', status: 'pending', nextAttemptAt: null,
      }),
    ]);
    h.emailService.send.mockResolvedValue({ sent: true, provider: 'smtp' });

    expect(await h.service.processPendingDeliveries()).toBe(2);
    expect(h.emailService.send).toHaveBeenCalledTimes(2);
    expect(h.state.deliveries.find((row) => row.id.endsWith('0003'))?.status).toBe('pending');
    expect(h.state.deliveries.find((row) => row.id.endsWith('0004'))?.status).toBe('failed');
    expect(h.state.deliveries.find((row) => row.id.endsWith('0006'))?.status).toBe('pending');
  });

  it('caps permanent automatic failures and later actions do not hot-loop terminal mail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
    const h = createHarness([delivery()]);
    h.emailService.send.mockResolvedValue({ sent: false, provider: 'smtp', error: 'no route' });
    const expectedBackoffs = [30_000, 60_000, 120_000, 120_000];

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const attemptedAt = Date.now();
      await h.service.processPendingDeliveries();
      if (attempt < 5) {
        expect(h.state.deliveries[0]).toMatchObject({
          status: 'pending', automaticAttempts: attempt,
        });
        expect(h.state.deliveries[0]!.nextAttemptAt!.getTime() - attemptedAt)
          .toBe(expectedBackoffs[attempt - 1]);
        vi.setSystemTime(h.state.deliveries[0]!.nextAttemptAt!);
      }
    }

    expect(h.state.deliveries[0]).toMatchObject({
      status: 'failed', attempts: 5, automaticAttempts: 5, nextAttemptAt: null,
    });
    await h.service.processPendingDeliveries();
    await h.service.deliverForRequestBestEffort(REQUEST_ID, PROPERTY_ID);
    expect(h.emailService.send).toHaveBeenCalledTimes(5);
  });

  it('terminalizes a due stale claim that already consumed the automatic attempt limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:10:00.000Z'));
    const stale = new Date('2026-08-25T00:00:00.000Z');
    const h = createHarness([delivery({
      status: 'processing',
      attempts: 5,
      automaticAttempts: 5,
      claimedAt: stale,
      nextAttemptAt: stale,
    })]);

    expect(await h.service.processPendingDeliveries()).toBe(1);
    expect(h.state.deliveries[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      automaticAttempts: 5,
      claimedAt: null,
      nextAttemptAt: null,
      errorMessage: 'Email transport failed',
    });
    expect(h.emailService.send).not.toHaveBeenCalled();
    expect(h.state.audits.map((audit) => audit.description)).toContain(
      'Booking request email delivery failed terminally',
    );
  });

  it('atomically reserves a manual retry so an automatic worker cannot steal it', async () => {
    const actor: AuditActor = {
      userId: 'dddddddd-0000-4000-a000-000000000001',
      userEmail: 'agent@example.com',
      ipAddress: '203.0.113.8',
    };
    const h = createHarness([delivery({
      status: 'failed',
      attempts: 5,
      automaticAttempts: 5,
      nextAttemptAt: null,
      errorMessage: 'Email transport failed',
    })]);
    let finishSend!: () => void;
    h.emailService.send.mockReturnValue(new Promise((resolve) => {
      finishSend = () => resolve({
        sent: true, provider: 'smtp', messageId: 'provider-retry-id',
      });
    }));

    const retrying = h.service.retry(DELIVERY_ID, REQUEST_ID, PROPERTY_ID, actor);
    await vi.waitFor(() => expect(h.emailService.send).toHaveBeenCalledOnce());

    expect(h.state.deliveries[0]).toMatchObject({
      status: 'processing',
      attempts: 6,
      automaticAttempts: 0,
      claimedAt: expect.any(Date),
      nextAttemptAt: expect.any(Date),
    });
    expect(h.state.deliveryUpdates).not.toContainEqual(expect.objectContaining({
      status: 'pending',
    }));
    expect(await h.service.processPendingDeliveries()).toBe(0);
    expect(h.emailService.send).toHaveBeenCalledOnce();

    finishSend();
    const retried = await retrying;

    expect(retried).toMatchObject({ status: 'sent', attempts: 6, errorMessage: null });
    expect(retried).not.toHaveProperty('providerMessageId');
    expect(h.state.audits.map((audit) => audit.description)).toEqual([
      'Booking request email delivery attempted',
      'Booking request email delivered',
    ]);
    expect(h.state.audits).toHaveLength(2);
    expect(h.state.audits.every((audit) =>
      audit.userId === actor.userId
      && audit.userEmail === actor.userEmail
      && audit.ipAddress === actor.ipAddress)).toBe(true);
  });

  it('rolls back a manual claim when its attributed audit cannot be persisted', async () => {
    const h = createHarness([delivery({
      status: 'failed',
      attempts: 5,
      automaticAttempts: 5,
      nextAttemptAt: null,
      errorMessage: 'Email transport failed',
    })], {
      failAuditDescription: 'Booking request email delivery attempted',
      failAuditTimes: 1,
    });

    await expect(h.service.retry(DELIVERY_ID, REQUEST_ID, PROPERTY_ID, {
      userId: 'dddddddd-0000-4000-a000-000000000001',
    })).rejects.toThrow('audit write failed');
    expect(h.state.deliveries[0]).toMatchObject({
      status: 'failed', attempts: 5, automaticAttempts: 5,
    });
    expect(h.emailService.send).not.toHaveBeenCalled();
    expect(h.state.audits).toHaveLength(0);
  });

  it('terminalizes a failed manual attempt and attributes both audits to staff', async () => {
    const actor: AuditActor = {
      userId: 'dddddddd-0000-4000-a000-000000000001',
      userEmail: 'agent@example.com',
      ipAddress: '203.0.113.8',
    };
    const h = createHarness([delivery({
      status: 'failed',
      attempts: 5,
      automaticAttempts: 5,
      nextAttemptAt: null,
      errorMessage: 'Email transport failed',
    })]);
    h.emailService.send.mockResolvedValue({
      sent: false, provider: 'smtp', error: 'temporary provider detail',
    });

    const result = await h.service.retry(DELIVERY_ID, REQUEST_ID, PROPERTY_ID, actor);

    expect(result).toMatchObject({
      status: 'failed',
      attempts: 6,
      nextAttemptAt: null,
      errorMessage: 'Email transport failed',
    });
    expect(await h.service.processPendingDeliveries()).toBe(0);
    expect(h.state.audits.map((audit) => audit.description)).toEqual([
      'Booking request email delivery attempted',
      'Booking request email delivery failed terminally',
    ]);
    expect(h.state.audits.every((audit) => audit.userId === actor.userId)).toBe(true);
  });

  it('returns the persisted manual-retry winner when final compare-and-set loses', async () => {
    const actor: AuditActor = {
      userId: 'dddddddd-0000-4000-a000-000000000001',
      userEmail: 'agent@example.com',
      ipAddress: '203.0.113.8',
    };
    const winner = delivery({
      status: 'sent',
      attempts: 7,
      automaticAttempts: 1,
      claimedAt: null,
      nextAttemptAt: null,
      sentAt: new Date('2026-08-25T00:00:10.000Z'),
      providerMessageId: 'persisted-winner-provider-id',
    });
    const h = createHarness([delivery({
      status: 'failed', attempts: 5, automaticAttempts: 5, nextAttemptAt: null,
    })], { casWinner: winner });
    h.emailService.send.mockResolvedValue({
      sent: false, provider: 'smtp', error: 'loser result',
    });

    const result = await h.service.retry(DELIVERY_ID, REQUEST_ID, PROPERTY_ID, actor);

    expect(result).toMatchObject({ status: 'sent', attempts: 7 });
    expect(result).not.toHaveProperty('providerMessageId');
    expect(h.state.audits.map((audit) => audit.description)).toEqual([
      'Booking request email delivery attempted',
    ]);
    expect(h.state.audits[0]).toMatchObject(actor);
  });

  it('rolls back the delivery claim when its attempt audit cannot be persisted', async () => {
    const h = createHarness([delivery({ nextAttemptAt: new Date(0) })], {
      failAuditDescription: 'Booking request email delivery attempted',
      failAuditTimes: 1,
    });

    await expect(h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID))
      .rejects.toThrow('audit write failed');
    expect(h.state.deliveries[0]).toMatchObject({
      status: 'pending', attempts: 0, automaticAttempts: 0, claimedAt: null,
    });
    expect(h.emailService.send).not.toHaveBeenCalled();
    expect(h.state.audits).toHaveLength(0);
  });

  it('does not let a normal slow send be reclaimed before its lease expires', async () => {
    let finishSend!: (result: { sent: boolean; provider: string; messageId: string }) => void;
    const pendingSend = new Promise<{ sent: boolean; provider: string; messageId: string }>(
      (resolve) => { finishSend = resolve; },
    );
    const h = createHarness([delivery({ nextAttemptAt: new Date(0) })]);
    h.emailService.send.mockReturnValue(pendingSend);

    const first = h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID);
    await vi.waitFor(() => expect(h.state.deliveries[0]?.status).toBe('processing'));
    expect(await h.service.processPendingDeliveries()).toBe(0);
    expect(await h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID)).toBeUndefined();
    expect(h.emailService.send).toHaveBeenCalledOnce();

    finishSend({ sent: true, provider: 'smtp', messageId: 'slow-provider-id' });
    await expect(first).resolves.toMatchObject({ status: 'sent' });
  });

  it('never releases a claim while the bounded provider operation is still active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
    const h = createHarness([delivery()]);
    let providerSettled = false;
    let settleProvider!: () => void;
    h.emailService.send.mockReturnValue(new Promise((resolve) => {
      settleProvider = () => {
        providerSettled = true;
        resolve({
          status: 'outcomeUnknown',
          sent: false,
          provider: 'smtp',
          error: 'Email transport timed out',
        });
      };
    }));

    const attempt = h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(providerSettled).toBe(false);
    expect(h.state.deliveries[0]).toMatchObject({
      status: 'processing',
      claimedAt: new Date('2026-08-25T00:00:00.000Z'),
      nextAttemptAt: new Date('2026-08-25T00:05:00.000Z'),
    });
    expect(await h.service.processPendingDeliveries()).toBe(0);
    expect(h.emailService.send).toHaveBeenCalledOnce();
    expect(h.emailService.send).toHaveBeenCalledWith(
      expect.any(Object),
      { timeoutMs: 60_000 },
    );

    settleProvider();
    await expect(attempt).resolves.toMatchObject({
      status: 'failed',
      claimedAt: null,
      nextAttemptAt: null,
      errorMessage: 'Email delivery outcome requires manual review',
    });
    expect(providerSettled).toBe(true);
  });

  it('reuses stable transport identity after an ambiguous committed send', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
    const h = createHarness([delivery()], {
      failAuditDescription: 'Booking request email delivered',
      failAuditTimes: 1,
    });
    h.emailService.send.mockResolvedValue({ sent: true, provider: 'smtp', messageId: 'provider-id' });

    await expect(h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID))
      .rejects.toThrow('audit write failed');
    expect(h.state.deliveries[0]).toMatchObject({ status: 'processing', attempts: 1 });
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await expect(h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID))
      .resolves.toMatchObject({ status: 'sent', attempts: 2 });
    expect(h.emailService.send).toHaveBeenCalledTimes(2);
    const identities = h.emailService.send.mock.calls.map((call) => ({
      idempotencyKey: call[0].idempotencyKey,
      messageId: call[0].messageId,
    }));
    expect(new Set(identities.map((identity) => JSON.stringify(identity))).size).toBe(1);
  });

  it('returns the persisted winner and writes no final audit when its final CAS loses', async () => {
    const winner = delivery({
      status: 'sent',
      attempts: 2,
      automaticAttempts: 2,
      claimedAt: null,
      nextAttemptAt: null,
      sentAt: new Date('2026-08-25T00:00:10.000Z'),
      providerMessageId: 'winner-provider-id',
    });
    const h = createHarness([delivery({ nextAttemptAt: new Date(0) })], { casWinner: winner });
    h.emailService.send.mockResolvedValue({
      sent: false, provider: 'smtp', error: 'loser result',
    });

    const result = await h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID);

    expect(result).toEqual(winner);
    expect(h.state.audits.map((audit) => audit.description)).toEqual([
      'Booking request email delivery attempted',
    ]);
  });
});

describe('Booking Request email API and webhook contract', () => {
  it('uses reservation read for history and reservation write for retry', () => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSIONS_KEY, BookingRequestController.prototype.listEmailDeliveries))
      .toEqual(['reservations.read']);
    expect(reflector.get(PERMISSIONS_KEY, BookingRequestController.prototype.retryEmailDelivery))
      .toEqual(['reservations.write']);
  });

  it('forwards the authenticated audit actor into a manual retry', async () => {
    const actor: AuditActor = {
      userId: 'dddddddd-0000-4000-a000-000000000001',
      userEmail: 'agent@example.com',
      ipAddress: '203.0.113.8',
    };
    const mailer = { retry: vi.fn().mockResolvedValue({ status: 'sent' }) };
    const controller = new BookingRequestController(
      {} as ConstructorParameters<typeof BookingRequestController>[0],
      {} as ConstructorParameters<typeof BookingRequestController>[1],
      mailer as unknown as ConstructorParameters<typeof BookingRequestController>[2],
    );
    await (controller.retryEmailDelivery as unknown as (...args: unknown[]) => Promise<unknown>)(
      REQUEST_ID,
      DELIVERY_ID,
      PROPERTY_ID,
      actor,
    );
    expect(mailer.retry).toHaveBeenCalledWith(DELIVERY_ID, REQUEST_ID, PROPERTY_ID, actor);
  });

  it('publishes typed request lifecycle event names', () => {
    expect(WEBHOOK_EVENTS).toMatchObject({
      'booking_request.created': 'booking_request.created',
      'booking_request.accepted': 'booking_request.accepted',
      'booking_request.denied': 'booking_request.denied',
    });
  });
});
