import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ImportService } from './import.service';
import { parseCsv, applyMapping } from './csv.util';

const PROP = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('parseCsv', () => {
  it('parses headers + rows, handling quotes and embedded commas', () => {
    const csv = 'firstName,lastName,email\n"Ada","Lovelace","ada@x.com"\nGrace,"Hop,per",grace@x.com';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com' });
    expect(rows[1]!.lastName).toBe('Hop,per');
  });

  it('skips blank trailing lines', () => {
    expect(parseCsv('firstName,lastName\nAda,Lovelace\n')).toHaveLength(1);
  });
});

describe('applyMapping', () => {
  it('renames source columns to canonical fields', () => {
    const mapped = applyMapping({ 'First Name': 'Ada', Surname: 'Lovelace' }, {
      'First Name': 'firstName',
      Surname: 'lastName',
    });
    expect(mapped.firstName).toBe('Ada');
    expect(mapped.lastName).toBe('Lovelace');
  });
});

describe('ImportService', () => {
  let guest: any;
  let room: any;
  let ratePlan: any;
  let svc: ImportService;

  beforeEach(() => {
    guest = { create: vi.fn().mockResolvedValue({ id: 'g-1' }) };
    room = { createRoomType: vi.fn().mockResolvedValue({ id: 'rt-1' }) };
    ratePlan = { create: vi.fn().mockResolvedValue({ id: 'rp-1' }) };
    svc = new ImportService(guest as any, room as any, ratePlan as any);
  });

  it('lists importable entities with their template columns', () => {
    const entities = svc.listEntities().map((e) => e.entity);
    expect(entities).toEqual(expect.arrayContaining(['guests', 'room-types', 'rate-plans']));
  });

  it('dry run validates without creating anything', async () => {
    const csv = 'firstName,lastName\nAda,Lovelace\nGrace,Hopper';
    const res = await svc.run(PROP, 'guests', { csv, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.created).toBe(2);
    expect(guest.create).not.toHaveBeenCalled();
  });

  it('commit creates each row via the guest service', async () => {
    const csv = 'firstName,lastName,email\nAda,Lovelace,ada@x.com';
    const res = await svc.run(PROP, 'guests', { csv });
    expect(guest.create).toHaveBeenCalledOnce();
    expect(res.created).toBe(1);
    expect(res.results[0]).toMatchObject({ index: 0, success: true, id: 'g-1' });
  });

  it('reports a per-row error without aborting the batch', async () => {
    const csv = 'firstName,lastName\nAda,Lovelace\n,Missing';
    const res = await svc.run(PROP, 'guests', { csv });
    expect(res.created).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.results[1]!.success).toBe(false);
    expect(res.results[1]!.error).toMatch(/firstName/);
  });

  it('scopes room-type imports to the request propertyId', async () => {
    const csv = 'name,code,maxOccupancy,defaultOccupancy\nKing,KNG,2,2';
    await svc.run(PROP, 'room-types', { csv });
    expect(room.createRoomType).toHaveBeenCalledWith(expect.objectContaining({ propertyId: PROP, code: 'KNG' }));
  });

  it('rejects an unknown entity', async () => {
    await expect(svc.run(PROP, 'nope', { rows: [{ a: '1' }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty import', async () => {
    await expect(svc.run(PROP, 'guests', { rows: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies a column mapping before creating', async () => {
    const csv = 'First,Last\nAda,Lovelace';
    const res = await svc.run(PROP, 'guests', { csv, mapping: { First: 'firstName', Last: 'lastName' } });
    expect(res.created).toBe(1);
    expect(guest.create).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Ada', lastName: 'Lovelace' }));
  });
});
