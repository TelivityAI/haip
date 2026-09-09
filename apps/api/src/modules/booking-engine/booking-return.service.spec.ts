import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { BookingReturnService } from './booking-return.service';

function setup(status = 'pending') {
  const where = vi.fn().mockResolvedValue([{ status, createdAt: new Date() }]);
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }) };
  const settings: Record<string, string> = { BOOKING_RETURN_ORIGINS: 'https://hotel.example', PUBLIC_API_BASE_URL: 'https://api.example', NODE_ENV: 'production' };
  const config = { get: vi.fn((key: string) => settings[key]) };
  return { service: new BookingReturnService(db as any, config as any), where, db, settings };
}

const PROPERTY = '11111111-1111-4111-a111-111111111111';
const referenceOf = (url: string) => new URL(url).pathname.split('/').at(-1)!;

describe('BookingReturnService', () => {
  it('preserves the embedding page and binds both outcomes to one opaque reference', () => {
    const { service } = setup();
    const result = service.prepare(PROPERTY, 'https://hotel.example/stays/book?lang=es&redsys=ok&haip_payment_return=old&Ds_Signature=stale&DS_MERCHANTPARAMETERS=stale#rooms');
    const url = new URL(result.destination);
    expect(url.pathname).toBe('/stays/book');
    expect(url.searchParams.get('lang')).toBe('es');
    expect(url.hash).toBe('#rooms');
    expect(url.searchParams.has('redsys')).toBe(false);
    expect(url.searchParams.has('Ds_Signature')).toBe(false);
    expect(url.searchParams.has('DS_MERCHANTPARAMETERS')).toBe(false);
    const reference = referenceOf(result.url);
    expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new URL(result.url).origin).toBe('https://api.example');
    expect(new URL(result.url).searchParams.get('propertyId')).toBe(PROPERTY);
    expect(result.url.length).toBeLessThanOrEqual(250);
    expect(result.destination).not.toContain(reference);
    expect(result.referenceHash).toBe(createHash('sha256').update(reference).digest('hex'));
    expect(service.prepare(PROPERTY, 'https://hotel.example/stays/book').referenceHash).not.toBe(result.referenceHash);
  });

  it.each(['https://attacker.example/book', 'https://hotel.example.attacker.example/book', 'javascript:alert(1)', 'http://hotel.example/book', 'https://user:pass@hotel.example/book', undefined])('rejects unsafe/unconfigured destination %s', (url) => {
    expect(() => setup().service.prepare(PROPERTY, url)).toThrow(/return/i);
  });

  it.each([['pending', 'processing'], ['authorized', 'succeeded'], ['captured', 'succeeded'], ['failed', 'failed'], ['voided', 'cancelled']])('maps authoritative %s to %s without exposing guest data', async (status, expected) => {
    const { service, where } = setup(status);
    const reference = referenceOf(service.prepare(PROPERTY, 'https://hotel.example/book').url);
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

  it.each([249, 250, 251, 2048])('preserves a %i-character host URL behind the same compact relay', async (length) => {
    const { service, where } = setup();
    const prefix = 'https://hotel.example/stays/book?lang=es&context=';
    const destination = prefix + 'a'.repeat(length - prefix.length - '#rooms'.length) + '#rooms';
    expect(destination.length).toBe(length);
    const prepared = service.prepare(PROPERTY, destination);
    expect(prepared.url.length).toBeLessThanOrEqual(250);
    expect(prepared.destination).toBe(destination);
    expect(prepared.url).not.toContain('context=');
    const reference = referenceOf(prepared.url);
    where.mockResolvedValue([{ bookingReturnDestination: prepared.destination, createdAt: new Date() }]);
    const target = new URL(destination);
    target.searchParams.set('haip_payment_return', reference);
    expect(await service.resolve(PROPERTY, reference)).toBe(target.href);
  });

  it('accepts exactly 250 provider URL characters and rejects 251 before writing', () => {
    const { service, settings, db } = setup();
    const initial = service.prepare(PROPERTY, 'https://hotel.example/book');
    settings.PUBLIC_API_BASE_URL += '/' + 'a'.repeat(250 - initial.url.length - 1);
    expect(service.prepare(PROPERTY, 'https://hotel.example/book').url.length).toBe(250);
    settings.PUBLIC_API_BASE_URL += 'a';
    expect(() => service.prepare(PROPERTY, 'https://hotel.example/book')).toThrow(/250/);
    expect(db.select).not.toHaveBeenCalled();
  });

  it.each(['http://api.example', 'https://user:password@api.example', 'https://api.example?next=evil', 'https://api.example#fragment', 'https://api.example?', 'https://api.example#', 'javascript:alert(1)'])('rejects an unsafe relay configuration %s', (base) => {
    const { service, settings } = setup();
    settings.PUBLIC_API_BASE_URL = base;
    expect(() => service.prepare(PROPERTY, 'https://hotel.example/book')).toThrow(/return/i);
  });

  it('rejects malformed, unknown, expired, unbound and no-longer-allowed relay references', async () => {
    const { service, where, db, settings } = setup();
    await expect(service.resolve(PROPERTY, '../evil')).rejects.toThrow(/not found/i);
    expect(db.select).not.toHaveBeenCalled();
    where.mockResolvedValueOnce([]);
    await expect(service.resolve(PROPERTY, 'a'.repeat(43))).rejects.toThrow(/not found/i);
    for (const row of [
      { bookingReturnDestination: 'https://hotel.example/book', createdAt: new Date(0) },
      { bookingReturnDestination: null, createdAt: new Date() },
      { bookingReturnDestination: 'https://attacker.example/book', createdAt: new Date() },
      { bookingReturnDestination: 'https://user:pass@hotel.example/book', createdAt: new Date() },
    ]) {
      where.mockResolvedValueOnce([row]);
      await expect(service.resolve(PROPERTY, 'a'.repeat(43))).rejects.toThrow(/not found/i);
    }
    settings.BOOKING_RETURN_ORIGINS = '';
    where.mockResolvedValueOnce([{ bookingReturnDestination: 'https://hotel.example/book', createdAt: new Date() }]);
    await expect(service.resolve(PROPERTY, 'a'.repeat(43))).rejects.toThrow(/not found/i);
  });

  it('binds the relay lookup to property, hash and provider without accepting a destination', async () => {
    const { service, where } = setup();
    where.mockResolvedValue([{ bookingReturnDestination: 'https://hotel.example/book', createdAt: new Date() }]);
    await service.resolve(PROPERTY, 'a'.repeat(43));
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.params).toEqual(expect.arrayContaining([PROPERTY, createHash('sha256').update('a'.repeat(43)).digest('hex'), 'redsys']));
    expect(query.params).not.toContain('a'.repeat(43));
  });
});
