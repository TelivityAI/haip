import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  auditLogs,
  bookingRequestEmailDeliveries,
  bookingRequests,
} from '@telivityhaip/database';
import { WEBHOOK_EVENTS } from '@telivityhaip/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    claimedAt: null,
    lastAttemptAt: null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createHarness(seed: Delivery[] = []) {
  const state = {
    requests: [{ id: REQUEST_ID, propertyId: PROPERTY_ID }],
    deliveries: seed.map((row) => ({ ...row })),
    audits: [] as Array<Record<string, unknown>>,
  };

  const insert = vi.fn((table: unknown) => ({
    values: (values: Record<string, any>) => {
      if (table === auditLogs) {
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
          Object.assign(current, changes);
          return [current];
        },
        then: (resolve: (value: any) => unknown) => {
          const current = state.deliveries.find((row) => conditionContains(condition, row.id));
          if (table === bookingRequestEmailDeliveries && current) {
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
    transaction: (work: (tx: any) => unknown) => work(db),
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
  beforeEach(() => vi.restoreAllMocks());

  it('persists one pending delivery per stable logical action before sending', async () => {
    const h = createHarness();
    h.emailService.send.mockImplementation(async () => {
      expect(h.state.deliveries[0]).toMatchObject({ status: 'pending', attempts: 1 });
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
    expect(result).toMatchObject({ status: 'sent', attempts: 1, errorMessage: null });
    expect(h.emailService.send).toHaveBeenCalledOnce();
  });

  it('records a safe failed result without throwing and retries it durably', async () => {
    const h = createHarness([delivery()]);
    h.emailService.send
      .mockRejectedValueOnce(new Error('smtp password secret-token and pm_123 leaked'))
      .mockResolvedValueOnce({ sent: true, provider: 'smtp' });

    const failed = await h.service.deliver(DELIVERY_ID, REQUEST_ID, PROPERTY_ID);
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 1,
      errorMessage: 'Email transport failed',
    });
    expect(failed?.errorMessage).not.toMatch(/secret|pm_123|password/i);

    const sent = await h.service.retry(DELIVERY_ID, REQUEST_ID, PROPERTY_ID);
    expect(sent).toMatchObject({ status: 'sent', attempts: 2, errorMessage: null });
    expect(h.emailService.send).toHaveBeenCalledTimes(2);
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
    await expect(h.service.retry(DELIVERY_ID, REQUEST_ID, OTHER_PROPERTY_ID))
      .rejects.toBeInstanceOf(NotFoundException);
    const own = await h.service.listForRequest(REQUEST_ID, PROPERTY_ID);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ propertyId: PROPERTY_ID, bookingRequestId: REQUEST_ID });
  });

  it('recovers pending and failed deliveries while never redelivering sent mail', async () => {
    const h = createHarness([
      delivery(),
      delivery({ id: 'cccccccc-0000-4000-a000-000000000002', status: 'failed' }),
      delivery({ id: 'cccccccc-0000-4000-a000-000000000003', status: 'sent' }),
    ]);
    h.emailService.send.mockResolvedValue({ sent: true, provider: 'smtp' });

    expect(await h.service.processPendingDeliveries()).toBe(2);
    expect(h.emailService.send).toHaveBeenCalledTimes(2);
    expect(h.state.deliveries.every((row) => row.status === 'sent')).toBe(true);
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

  it('publishes typed request lifecycle event names', () => {
    expect(WEBHOOK_EVENTS).toMatchObject({
      'booking_request.created': 'booking_request.created',
      'booking_request.accepted': 'booking_request.accepted',
      'booking_request.denied': 'booking_request.denied',
    });
  });
});
