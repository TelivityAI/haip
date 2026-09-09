import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { BookingReturnService } from './booking-return.service';

function setup(status = 'pending') {
  const where = vi.fn().mockResolvedValue([{ status, createdAt: new Date() }]);
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  const config = { get: vi.fn((key: string) => key === 'BOOKING_RETURN_ORIGINS' ? 'https://hotel.example' : 'production') };
  return { service: new BookingReturnService(db as any, config as any), where, db };
}

describe('BookingReturnService', () => {
  it('preserves the embedding page and binds both outcomes to one opaque reference', () => {
    const { service } = setup();
    const result = service.prepare('https://hotel.example/stays/book?lang=es&redsys=ok&haip_payment_return=old&Ds_Signature=stale&DS_MERCHANTPARAMETERS=stale#rooms');
    const url = new URL(result.url);
    expect(url.pathname).toBe('/stays/book');
    expect(url.searchParams.get('lang')).toBe('es');
    expect(url.hash).toBe('#rooms');
    expect(url.searchParams.has('redsys')).toBe(false);
    expect(url.searchParams.has('Ds_Signature')).toBe(false);
    expect(url.searchParams.has('DS_MERCHANTPARAMETERS')).toBe(false);
    const reference = url.searchParams.get('haip_payment_return')!;
    expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.referenceHash).toBe(createHash('sha256').update(reference).digest('hex'));
    expect(service.prepare('https://hotel.example/stays/book').referenceHash).not.toBe(result.referenceHash);
  });

  it.each(['https://attacker.example/book', 'https://hotel.example.attacker.example/book', 'javascript:alert(1)', 'http://hotel.example/book', 'https://user:pass@hotel.example/book', undefined])('rejects unsafe/unconfigured destination %s', (url) => {
    expect(() => setup().service.prepare(url)).toThrow(/return/i);
  });

  it.each([['pending', 'processing'], ['authorized', 'succeeded'], ['captured', 'succeeded'], ['failed', 'failed'], ['voided', 'cancelled']])('maps authoritative %s to %s without exposing guest data', async (status, expected) => {
    const { service, where } = setup(status);
    const reference = new URL(service.prepare('https://hotel.example/book').url).searchParams.get('haip_payment_return')!;
    expect(await service.status('property-1', reference)).toEqual({ status: expected });
    // Verify the actual Drizzle predicates, including tenant and credential hash.
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.params).toContain('property-1');
    expect(query.params).toContain(createHash('sha256').update(reference).digest('hex'));
    expect(query.params).not.toContain(reference);
  });

  it('fails closed for malformed, unknown and expired references', async () => {
    const { service, where, db } = setup();
    await expect(service.status('property-1', 'redsys=ok')).rejects.toThrow(/not found/i);
    expect(db.select).not.toHaveBeenCalled();
    where.mockResolvedValueOnce([]);
    await expect(service.status('property-1', 'a'.repeat(43))).rejects.toThrow(/not found/i);
    where.mockResolvedValueOnce([{ status: 'authorized', createdAt: new Date(0) }]);
    await expect(service.status('property-1', 'a'.repeat(43))).rejects.toThrow(/not found/i);
  });
});
