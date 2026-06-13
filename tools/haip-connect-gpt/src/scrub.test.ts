import { describe, it, expect } from 'vitest';
import { redactForLog, stripNetRate } from './scrub.js';

describe('redactForLog', () => {
  it('redacts guest PII and booking credentials, keeps analytical fields', () => {
    const input = {
      body: {
        city: 'New York',
        checkIn: '2026-06-01',
        adults: 2,
        guestFirstName: 'John',
        guestLastName: 'Smith',
        guestEmail: 'john@example.com',
        guestPhone: '+1-555-0100',
        loyaltyNumber: 'GOLD-1',
        specialRequests: 'high floor',
        paymentToken: 'tok_123',
      },
      params: { confirmationNumber: 'ABC123' },
    };

    const out = redactForLog(input) as typeof input;

    // kept
    expect(out.body.city).toBe('New York');
    expect(out.body.checkIn).toBe('2026-06-01');
    expect(out.body.adults).toBe(2);
    // redacted
    expect(out.body.guestFirstName).toBe('[redacted]');
    expect(out.body.guestLastName).toBe('[redacted]');
    expect(out.body.guestEmail).toBe('[redacted]');
    expect(out.body.guestPhone).toBe('[redacted]');
    expect(out.body.loyaltyNumber).toBe('[redacted]');
    expect(out.body.specialRequests).toBe('[redacted]');
    expect(out.body.paymentToken).toBe('[redacted]');
    expect(out.params.confirmationNumber).toBe('[redacted]');
  });

  it('redacts PII nested inside arrays', () => {
    const out = redactForLog({ guests: [{ guestName: 'Jane Doe', adults: 1 }] }) as {
      guests: { guestName: string; adults: number }[];
    };
    expect(out.guests[0].guestName).toBe('[redacted]');
    expect(out.guests[0].adults).toBe(1);
  });

  it('does not mutate the input', () => {
    const input = { guestEmail: 'a@b.com' };
    redactForLog(input);
    expect(input.guestEmail).toBe('a@b.com');
  });
});

describe('stripNetRate', () => {
  it('removes net / wholesale / commission fields', () => {
    const out = stripNetRate({
      totalAmount: 400,
      netRate: 320,
      wholesaleAmount: 300,
      commission: 80,
      markup: 25,
    }) as Record<string, unknown>;

    expect(out['totalAmount']).toBe(400);
    expect(out).not.toHaveProperty('netRate');
    expect(out).not.toHaveProperty('wholesaleAmount');
    expect(out).not.toHaveProperty('commission');
    expect(out).not.toHaveProperty('markup');
  });

  it('keeps legitimate selling-price fields whose names merely contain "cost"', () => {
    const out = stripNetRate({ costDifference: 50, previousAmount: 350, newAmount: 400 }) as Record<
      string,
      unknown
    >;
    expect(out['costDifference']).toBe(50);
    expect(out['previousAmount']).toBe(350);
    expect(out['newAmount']).toBe(400);
  });

  it('strips net fields nested in results arrays', () => {
    const out = stripNetRate({
      results: [{ rates: [{ totalAmount: 200, netAmount: 160 }] }],
    }) as { results: { rates: Record<string, unknown>[] }[] };
    expect(out.results[0].rates[0]['totalAmount']).toBe(200);
    expect(out.results[0].rates[0]).not.toHaveProperty('netAmount');
  });
});
