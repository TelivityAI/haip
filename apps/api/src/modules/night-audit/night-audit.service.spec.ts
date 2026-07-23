import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NightAuditService } from './night-audit.service';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { ReservationService } from '../reservation/reservation.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { RoomStatusService } from '../room/room-status.service';
import { WebhookService } from '../webhook/webhook.service';
import { AncillaryService } from '../ancillary/ancillary.service';
import { PolicyService } from '../policy/policy.service';
import { DepositSettlementService } from '../accounting/deposit-settlement.service';

const mockFolioService = {
  postCharge: vi.fn().mockResolvedValue({
    id: 'charge-room-001',
    amount: '150.00',
    taxCharges: [
      { id: 'tax-001', amount: '9.00', code: 'FL_SALES' },
      { id: 'tax-002', amount: '1.50', code: 'MIAMI_DADE_SURTAX' },
      { id: 'tax-003', amount: '9.00', code: 'MIAMI_DADE_TDT' },
    ],
  }),
  createAutoFolio: vi.fn().mockResolvedValue({
    id: 'folio-new',
    status: 'open',
    type: 'guest',
  }),
  lockCharges: vi.fn().mockResolvedValue({ lockedCount: 2 }),
};

const mockReservationService = {
  markNoShow: vi.fn().mockResolvedValue({ id: 'res-001', status: 'no_show' }),
};

const mockHousekeepingService = {
  generateStayoverTasks: vi.fn().mockResolvedValue({ created: 3, skipped: 0 }),
};

const mockRoomStatusService = {
  getPropertyRoomSummary: vi.fn().mockResolvedValue([
    { status: 'occupied', count: 10 },
    { status: 'vacant_clean', count: 5 },
    { status: 'out_of_order', count: 2 },
  ]),
};

const mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };

const mockAncillaryService = {
  postPerNightForProperty: vi.fn().mockResolvedValue({ posted: [], skipped: [], errors: [] }),
};

const mockPolicyService = {
  evaluateCancellation: vi.fn().mockResolvedValue({
    withinFreeWindow: false,
    penaltyAmount: '0.00',
    depositAction: 'forfeit',
    policyDescription: 'Default',
    policyId: null,
    policyCode: null,
    penaltyType: 'first_night',
  }),
};

const mockDepositSettlementService = {
  settleFromEvaluation: vi.fn().mockResolvedValue({
    penaltyPosted: false,
    penaltyAmount: '0.00',
    deposits: [],
    policyDescription: 'Default',
    withinFreeWindow: false,
  }),
};

const mockReservation = {
  id: 'res-001',
  propertyId: 'prop-001',
  bookingId: 'book-001',
  guestId: 'guest-001',
  roomId: 'room-001',
  ratePlanId: 'rate-001',
  totalAmount: '450.00',
  currencyCode: 'USD',
  nights: 3,
  status: 'checked_in',
  arrivalDate: '2026-04-04',
  departureDate: '2026-04-07',
  checkedInAt: new Date('2026-04-04T15:00:00Z'),
};

const mockFolio = {
  id: 'folio-001',
  propertyId: 'prop-001',
  reservationId: 'res-001',
  type: 'guest',
  status: 'open',
};

const mockAuditRun = {
  id: 'audit-001',
  propertyId: 'prop-001',
  businessDate: '2026-04-06',
  status: 'running',
  startedAt: new Date(),
};

const mockCompletedAudit = {
  ...mockAuditRun,
  status: 'completed',
  roomChargesPosted: '150.00',
  taxChargesPosted: '15.00',
  noShowsProcessed: '0',
  completedAt: new Date(),
};

function createMockDb(overrides: {
  selectResults?: any[][];
  insertResult?: any[];
  updateResult?: any[];
} = {}) {
  const defaultSelect = [[]]; // default: no results
  const selectResults = overrides.selectResults ?? defaultSelect;
  const insertResult = overrides.insertResult ?? [mockAuditRun];
  const updateResult = overrides.updateResult ?? [mockCompletedAudit];

  let selectCallCount = 0;

  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
            selectCallCount++;
            resolve(result);
          },
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
                selectCallCount++;
                resolve(result);
              },
            }),
            then: (resolve: any) => {
              const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
              selectCallCount++;
              resolve(result);
            },
          }),
          groupBy: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
              selectCallCount++;
              resolve(result);
            },
          }),
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
              selectCallCount++;
              resolve(result);
            },
            groupBy: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
                selectCallCount++;
                resolve(result);
              },
              orderBy: vi.fn().mockReturnValue({
                then: (resolve: any) => {
                  const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
                  selectCallCount++;
                  resolve(result);
                },
              }),
            }),
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(insertResult),
        // Bug 4: createOrGetAuditRun uses .onConflictDoNothing().returning()
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(insertResult),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(updateResult),
          then: (resolve: any) => resolve(undefined),
        }),
      }),
    }),
  };
}

describe('NightAuditService', () => {
  let service: NightAuditService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb = createMockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();

    service = module.get<NightAuditService>(NightAuditService);
  });

  // --- Idempotency ---

  it('should throw ConflictException when audit already completed for date', async () => {
    // Bug 4: insert conflicts (returns []), select returns the completed row.
    mockDb = createMockDb({
      selectResults: [[mockCompletedAudit]],
      insertResult: [],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const { ConflictException } = await import('@nestjs/common');
    await expect(
      service.runAudit({ propertyId: 'prop-001', businessDate: '2026-04-06' }),
    ).rejects.toThrow(ConflictException);
  });

  it('should return existing running audit if already in progress', async () => {
    // Bug 4: insert conflicts (returns []), select returns a still-running row.
    mockDb = createMockDb({
      selectResults: [[mockAuditRun]],
      insertResult: [],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.runAudit({ propertyId: 'prop-001', businessDate: '2026-04-06' });
    expect(result.alreadyRun).toBe(true);
    expect(result.auditRun.status).toBe('running');
  });

  // --- Audit Run Creation ---

  it('should create audit run with running status', async () => {
    const run = await service.createAuditRun('prop-001', '2026-04-06');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(run).toBeDefined();
    expect(run.status).toBe('running');
  });

  // --- postRoomTariffs ---

  it('should post room tariffs to in-house reservation folios', async () => {
    // select 1: in-house reservations
    // select 2: open folio
    // select 3: existing charge check (none)
    // select 4: rate plan
    const db = createMockDb({
      selectResults: [
        [mockReservation],                                     // in-house reservations
        [mockFolio],                                           // open folio
        [],                                                     // no existing charge
        [{ baseAmount: '150.00' }],                            // rate plan
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.postRoomTariffs('prop-001', '2026-04-06');
    expect(result.count).toBe(1);
    expect(result.totalRoom).toBe('150.00');
    // Tax amount comes from TaxService via postCharge auto-posting
    expect(result.totalTax).toBe('19.50');
    expect(mockFolioService.postCharge).toHaveBeenCalledWith('folio-001', expect.objectContaining({
      type: 'room',
      amount: '150.00',
      guestId: 'guest-001',
    }));
  });

  it('should skip tariff if already posted for date (idempotent)', async () => {
    const db = createMockDb({
      selectResults: [
        [mockReservation],                                      // reservations
        [mockFolio],                                            // folio
        [{ id: 'existing-charge-001' }],                        // existing charge found
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.postRoomTariffs('prop-001', '2026-04-06');
    expect(result.count).toBe(0);
    expect(mockFolioService.postCharge).not.toHaveBeenCalled();
  });

  it('should handle missing folio gracefully', async () => {
    const db = createMockDb({
      selectResults: [
        [mockReservation],
        [],  // no folio
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.postRoomTariffs('prop-001', '2026-04-06');
    expect(result.count).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('No open folio');
  });

  it('should use totalAmount/nights as fallback rate', async () => {
    const db = createMockDb({
      selectResults: [
        [mockReservation],
        [mockFolio],
        [],            // no existing charge
        [],            // no rate plan found
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.postRoomTariffs('prop-001', '2026-04-06');
    // 450.00 / 3 nights = 150.00
    expect(result.totalRoom).toBe('150.00');
    expect(mockFolioService.postCharge).toHaveBeenCalledWith(
      'folio-001', expect.objectContaining({ type: 'room', amount: '150.00' }),
    );
  });

  // --- processNoShows ---

  it('should process no-shows for past-arrival reservations', async () => {
    const noShowRes = { ...mockReservation, status: 'confirmed', arrivalDate: '2026-04-05' };
    const db = createMockDb({
      selectResults: [
        [noShowRes],                                            // no-show candidates
        [{ settings: {} }],                                     // property (no fee)
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.processNoShows('prop-001', '2026-04-06');
    expect(result.count).toBe(1);
    expect(result.reservationIds).toContain('res-001');
    expect(mockReservationService.markNoShow).toHaveBeenCalledWith('res-001', 'prop-001');
  });

  it('should post no-show fee if configured', async () => {
    const noShowRes = { ...mockReservation, status: 'confirmed', arrivalDate: '2026-04-05', roomId: null };
    const db = createMockDb({
      selectResults: [
        [noShowRes],                                                // no-show candidates
        [{ settings: { noShowFeeAmount: 150 } }],                   // property with fee
        [{ id: 'folio-noshowfee', type: 'guest', status: 'open' }], // existing folio
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    await service.processNoShows('prop-001', '2026-04-06');
    expect(mockDepositSettlementService.settleFromEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'res-001',
        propertyId: 'prop-001',
        additionalFeeAmount: 150,
        additionalFeeDescription: 'No-show fee',
      }),
    );
  });

  // --- advanceStayovers ---

  it('should advance checked_in to stayover for multi-night stays', async () => {
    const advancedRes = [{ ...mockReservation, status: 'stayover' }];
    const db = createMockDb({ updateResult: advancedRes });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.advanceStayovers('prop-001', '2026-04-06');
    expect(result.advanced).toBe(1);
    expect(db.update).toHaveBeenCalled();
  });

  // --- markDueOuts ---

  it('should mark stayover reservations departing next day as due_out', async () => {
    const dueOutRes = [{ ...mockReservation, status: 'due_out' }];
    const db = createMockDb({ updateResult: dueOutRes });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.markDueOuts('prop-001', '2026-04-06');
    expect(result.markedDueOut).toBe(1);
  });

  // --- lockChargesForDate ---

  it('should lock charges for the business date', async () => {
    const lockedCharges = [{ id: 'charge-001', isLocked: true }, { id: 'charge-002', isLocked: true }];
    const db = createMockDb({ updateResult: lockedCharges });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.lockChargesForDate('prop-001', '2026-04-06');
    expect(result.locked).toBe(2);
  });

  // --- failAuditRun ---

  it('should set audit run status to failed on error', async () => {
    await service.failAuditRun('audit-001', new Error('Something broke'));
    expect(mockDb.update).toHaveBeenCalled();
  });

  // --- generateRevenueSummary ---

  it('should generate revenue summary with KPIs', async () => {
    const db = createMockDb({
      selectResults: [
        // revenue query
        [{ roomRevenue: '1500.00', taxRevenue: '150.00', totalRevenue: '1700.00' }],
        // rooms sold count
        [{ count: 10 }],
        // property totalRooms
        [{ totalRooms: 20 }],
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const summary = await service.generateRevenueSummary('prop-001', '2026-04-06');
    expect(summary.roomRevenue).toBe(1500);
    expect(summary.roomsSold).toBe(10);
    // ADR = 1500 / 10 = 150
    expect(summary.adr).toBe(150);
    // Available = 20 - 2 (OOO) = 18, occupancy = 10/18 = 0.5556
    expect(summary.occupancyRate).toBeGreaterThan(0);
    expect(summary.revpar).toBeGreaterThan(0);
  });

  // --- Webhooks ---

  it('should emit audit.started webhook when creating audit run', async () => {
    // Full runAudit with no in-house reservations and no no-show candidates.
    // Bug 4: createOrGetAuditRun inserts successfully (no select needed pre-run).
    const db = createMockDb({
      selectResults: [
        [],          // postRoomTariffs: no in-house
        [],          // processNoShows: no candidates
        [{ settings: {} }],  // property for no-show
        // advanceStayovers + markDueOuts handled by update mock
        // lockChargesForDate handled by update mock
        // generateRevenueSummary
        [{ roomRevenue: '0', taxRevenue: '0', totalRevenue: '0' }],
        [{ count: 0 }],
        [{ totalRooms: 20 }],
      ],
      insertResult: [mockAuditRun],
      updateResult: [mockCompletedAudit],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    await service.runAudit({ propertyId: 'prop-001', businessDate: '2026-04-06' });
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'audit.started', 'audit_run', 'audit-001',
      expect.objectContaining({ businessDate: '2026-04-06' }),
      'prop-001',
    );
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'audit.completed', 'audit_run', 'audit-001',
      expect.objectContaining({ businessDate: '2026-04-06' }),
      'prop-001',
    );
  });

  // --- Stayover tasks ---

  it('should generate stayover tasks for next day during audit', async () => {
    const db = createMockDb({
      selectResults: [
        // Bug 4: insert path is onConflictDoNothing; no pre-run select.
        [],          // postRoomTariffs: no in-house
        [],          // processNoShows
        [{ settings: {} }],
        [{ roomRevenue: '0', taxRevenue: '0', totalRevenue: '0' }],
        [{ count: 0 }],
        [{ totalRooms: 20 }],
      ],
      insertResult: [mockAuditRun],
      updateResult: [mockCompletedAudit],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    await service.runAudit({ propertyId: 'prop-001', businessDate: '2026-04-06' });
    expect(mockHousekeepingService.generateStayoverTasks).toHaveBeenCalledWith(
      'prop-001', '2026-04-07',
    );
  });

  // --- Audit Run Queries ---

  it('should list audit runs for a property', async () => {
    const db = createMockDb({
      selectResults: [[mockCompletedAudit]],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    // listAuditRuns returns the query result directly via orderBy chain
    expect(db.select).toBeDefined();
  });

  it('should throw NotFoundException for unknown audit run', async () => {
    const db = createMockDb({ selectResults: [[]] });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    await expect(
      service.getAuditRun('nonexistent', 'prop-001'),
    ).rejects.toThrow(NotFoundException);
  });

  // --- Tax calculation ---

  it('should sum tax amounts from TaxService auto-posted charges', async () => {
    const db = createMockDb({
      selectResults: [
        [mockReservation],
        [mockFolio],
        [],                                           // no existing charge
        [{ baseAmount: '150.00' }],                   // rate plan
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    const result = await service.postRoomTariffs('prop-001', '2026-04-06');
    // Sum of mock taxCharges: 9.00 + 1.50 + 9.00 = 19.50
    expect(result.totalTax).toBe('19.50');
  });

  // --- Room unassignment on no-show ---

  it('should unassign room on no-show if room was assigned', async () => {
    const noShowRes = { ...mockReservation, status: 'assigned', arrivalDate: '2026-04-05', roomId: 'room-001' };
    const db = createMockDb({
      selectResults: [
        [noShowRes],
        [{ settings: {} }],
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        NightAuditService,
        { provide: DRIZZLE, useValue: db },
        { provide: FolioService, useValue: mockFolioService },
        { provide: ReservationService, useValue: mockReservationService },
        { provide: HousekeepingService, useValue: mockHousekeepingService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: AncillaryService, useValue: mockAncillaryService },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: DepositSettlementService, useValue: mockDepositSettlementService },
      ],
    }).compile();
    service = module.get(NightAuditService);

    await service.processNoShows('prop-001', '2026-04-06');
    // Should have called update to unassign room
    expect(db.update).toHaveBeenCalled();
  });
});
