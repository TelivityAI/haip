import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationService } from './migration.service';

const PROP = 'aaaaaaaa-0000-4000-a000-000000000001';
const PROJECT = 'proj-1';
const RT_UUID = 'bbbbbbbb-0000-4000-a000-000000000002';
const GUEST_UUID = 'cccccccc-0000-4000-a000-000000000003';
const RP_UUID = 'dddddddd-0000-4000-a000-000000000004';

// These tests drive processRow directly (row semantics: id-map skip, reference
// resolution, dry-run, per-entity persist). Queue/checkpoint flow is covered by
// the live smoke test; db access is not exercised here.
describe('MigrationService', () => {
  let svc: MigrationService;
  let idMapSvc: any;
  let guest: any;
  let room: any;
  let ratePlan: any;
  let reservation: any;
  let folio: any;
  let cryptoSvc: any;

  beforeEach(() => {
    guest = { create: vi.fn().mockResolvedValue({ id: GUEST_UUID }) };
    room = {
      createRoomType: vi.fn().mockResolvedValue({ id: RT_UUID }),
      createRoom: vi.fn().mockResolvedValue({ id: 'room-1' }),
    };
    ratePlan = { create: vi.fn().mockResolvedValue({ id: 'rp-1' }) };
    reservation = { create: vi.fn().mockResolvedValue({ id: 'res-1' }) };
    folio = {
      create: vi.fn().mockResolvedValue({ id: 'folio-1' }),
      postCharge: vi.fn().mockResolvedValue({ id: 'charge-1' }),
    };
    idMapSvc = {
      loadForEntity: vi.fn().mockResolvedValue(new Map()),
      record: vi.fn().mockResolvedValue(undefined),
      resolve: vi.fn(),
    };
    cryptoSvc = { isEnabled: vi.fn().mockReturnValue(true) };
    svc = new MigrationService(
      {} as any,
      guest,
      room,
      ratePlan,
      reservation,
      folio,
      idMapSvc,
      cryptoSvc,
    );
  });

  it('skips rows whose legacyId is already mapped (idempotent re-run)', async () => {
    const outcome = await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'guests',
      row: { legacyId: 'OLD-1', firstName: 'Ada', lastName: 'Lovelace' },
      index: 0,
      dryRun: false,
      known: new Map([['OLD-1', GUEST_UUID]]),
    });
    expect(outcome.status).toBe('skipped');
    expect(outcome.haipId).toBe(GUEST_UUID);
    expect(guest.create).not.toHaveBeenCalled();
  });

  it('creates a guest and records the id mapping', async () => {
    const known = new Map<string, string>();
    const outcome = await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'guests',
      row: { legacyId: 'OLD-9', firstName: 'Grace', lastName: 'Hopper' },
      index: 0,
      dryRun: false,
      known,
    });
    expect(outcome.status).toBe('created');
    expect(guest.create).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Grace' }));
    expect(idMapSvc.record).toHaveBeenCalledWith(PROP, PROJECT, 'guests', 'OLD-9', GUEST_UUID);
    expect(known.get('OLD-9')).toBe(GUEST_UUID);
  });

  it('dry-run validates without writing or recording mappings', async () => {
    const outcome = await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'rooms',
      row: { legacyId: 'R-101', roomTypeId: RT_UUID, number: '101' },
      index: 0,
      dryRun: true,
      known: new Map(),
    });
    expect(outcome.status).toBe('validated');
    expect(room.createRoom).not.toHaveBeenCalled();
    expect(idMapSvc.record).not.toHaveBeenCalled();
  });

  it('resolves { legacyId } references through the id map', async () => {
    idMapSvc.resolve.mockResolvedValue(RT_UUID);
    const outcome = await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'rooms',
      row: { legacyId: 'R-102', roomTypeId: { legacyId: 'OLD-RT' }, number: '102' },
      index: 0,
      dryRun: false,
      known: new Map(),
    });
    expect(outcome.status).toBe('created');
    expect(idMapSvc.resolve).toHaveBeenCalledWith(PROP, PROJECT, 'room-types', 'OLD-RT');
    expect(room.createRoom).toHaveBeenCalledWith(expect.objectContaining({ roomTypeId: RT_UUID }));
  });

  it('fails the row (not the batch) on an unresolved reference', async () => {
    idMapSvc.resolve.mockResolvedValue(undefined);
    const outcome = await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'rooms',
      row: { legacyId: 'R-103', roomTypeId: { legacyId: 'NOPE' }, number: '103' },
      index: 2,
      dryRun: false,
      known: new Map(),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/Unresolved roomTypeId/);
    expect(room.createRoom).not.toHaveBeenCalled();
  });

  it('reservation rows default source and stash legacyId as externalConfirmation', async () => {
    idMapSvc.resolve
      .mockResolvedValueOnce(GUEST_UUID) // guestId
      .mockResolvedValueOnce(RT_UUID) // roomTypeId
      .mockResolvedValueOnce(RP_UUID); // ratePlanId
    await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'reservations',
      row: {
        legacyId: 'MEWS-RES-1',
        guestId: { legacyId: 'G1' },
        roomTypeId: { legacyId: 'RT1' },
        ratePlanId: { legacyId: 'RP1' },
        arrivalDate: '2026-09-01',
        departureDate: '2026-09-03',
        totalAmount: '300.00',
        currencyCode: 'USD',
      },
      index: 0,
      dryRun: false,
      known: new Map(),
    });
    expect(reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'direct',
        externalConfirmation: 'MEWS-RES-1',
        guestId: GUEST_UUID,
        roomTypeId: RT_UUID,
        ratePlanId: RP_UUID,
      }),
    );
  });

  it('folio-balances creates a guest folio with a single opening adjustment charge', async () => {
    const outcome = await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'folio-balances',
      row: { legacyId: 'FOL-1', guestId: GUEST_UUID, amount: '150.25', currencyCode: 'USD' },
      index: 0,
      dryRun: false,
      known: new Map(),
    });
    expect(outcome.status).toBe('created');
    expect(folio.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'guest', guestId: GUEST_UUID }),
    );
    expect(folio.postCharge).toHaveBeenCalledWith(
      'folio-1',
      expect.objectContaining({ type: 'adjustment', amount: '150.25', skipTaxCalculation: true }),
    );
  });

  it('folio-balances with a negative/credit balance posts no charge', async () => {
    await (svc as any).processRow({
      propertyId: PROP,
      projectRef: PROJECT,
      entity: 'folio-balances',
      row: { guestId: GUEST_UUID, amount: '-20.00', currencyCode: 'USD' },
      index: 0,
      dryRun: false,
      known: new Map(),
    });
    expect(folio.create).toHaveBeenCalled();
    expect(folio.postCharge).not.toHaveBeenCalled();
  });

  it('rejects credential storage when encryption is not configured', async () => {
    cryptoSvc.isEnabled.mockReturnValue(false);
    await expect(svc.storeSourceCredential(PROP, 'mews', 'secret')).rejects.toMatchObject({
      message: expect.stringMatching(/not configured/),
    });
  });
});
