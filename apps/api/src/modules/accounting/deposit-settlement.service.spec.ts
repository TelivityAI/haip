import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { DepositSettlementService } from './deposit-settlement.service';
import { DepositService } from './deposit.service';
import { FolioService } from '../folio/folio.service';
import { DRIZZLE } from '../../database/database.module';

describe('DepositSettlementService', () => {
  let service: DepositSettlementService;
  let db: any;

  const mockDepositService = {
    applyDeposit: vi.fn(),
    refundDeposit: vi.fn(),
    forfeitDeposit: vi.fn(),
  };

  const mockFolioService = {
    postCharge: vi.fn().mockResolvedValue({ id: 'charge-001' }),
    createAutoFolio: vi.fn().mockResolvedValue({ id: 'folio-001', type: 'guest' }),
  };

  function selectChain(result: any[]) {
    const c: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: undefined as any,
    };
    c.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject);
    return c;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = {
      select: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositSettlementService,
        { provide: DRIZZLE, useValue: db },
        { provide: DepositService, useValue: mockDepositService },
        { provide: FolioService, useValue: mockFolioService },
      ],
    }).compile();

    service = module.get(DepositSettlementService);
  });

  it('applyHeldDeposits applies each held deposit to folio', async () => {
    db.select.mockReturnValue(
      selectChain([
        { id: 'dep-1', amount: '50.00', status: 'held', isRefundable: true },
        { id: 'dep-2', amount: '25.00', status: 'held', isRefundable: true },
      ]),
    );
    mockDepositService.applyDeposit
      .mockResolvedValueOnce({ id: 'dep-1', amount: '50.00', status: 'applied' })
      .mockResolvedValueOnce({ id: 'dep-2', amount: '25.00', status: 'applied' });

    const applied = await service.applyHeldDeposits('res-001', 'prop-001', 'folio-001');
    expect(applied).toHaveLength(2);
    expect(mockDepositService.applyDeposit).toHaveBeenCalledTimes(2);
    expect(mockDepositService.applyDeposit).toHaveBeenCalledWith('dep-1', {
      propertyId: 'prop-001',
      folioId: 'folio-001',
    });
  });

  it('settleDeposits refunds refundable deposits when action is refund', async () => {
    db.select.mockReturnValue(
      selectChain([{ id: 'dep-1', amount: '100.00', status: 'held', isRefundable: true }]),
    );
    mockDepositService.refundDeposit.mockResolvedValue({
      id: 'dep-1',
      amount: '100.00',
      status: 'refunded',
    });

    const results = await service.settleDeposits('res-001', 'prop-001', 'refund');
    expect(results[0]!.status).toBe('refunded');
    expect(mockDepositService.refundDeposit).toHaveBeenCalledWith('dep-1', 'prop-001');
  });

  it('settleDeposits forfeits non-refundable deposits even when action is refund', async () => {
    db.select.mockReturnValue(
      selectChain([{ id: 'dep-1', amount: '100.00', status: 'held', isRefundable: false }]),
    );
    mockDepositService.forfeitDeposit.mockResolvedValue({
      id: 'dep-1',
      amount: '100.00',
      status: 'forfeited',
    });

    const results = await service.settleDeposits('res-001', 'prop-001', 'refund');
    expect(results[0]!.status).toBe('forfeited');
    expect(mockDepositService.forfeitDeposit).toHaveBeenCalled();
  });

  it('settleFromEvaluation posts penalty and settles deposits', async () => {
    db.select
      .mockReturnValueOnce(
        selectChain([{ id: 'dep-1', amount: '80.00', status: 'held', isRefundable: true }]),
      )
      .mockReturnValueOnce(selectChain([{ id: 'folio-001', type: 'guest' }]));

    mockDepositService.forfeitDeposit.mockResolvedValue({
      id: 'dep-1',
      amount: '80.00',
      status: 'forfeited',
    });

    const result = await service.settleFromEvaluation({
      reservationId: 'res-001',
      propertyId: 'prop-001',
      currencyCode: 'USD',
      evaluation: {
        withinFreeWindow: false,
        penaltyAmount: '100.00',
        depositAction: 'forfeit',
        policyDescription: 'First night charge',
        policyId: 'policy-1',
        policyCode: 'FLEX-24',
        penaltyType: 'first_night',
      },
    });

    expect(result.penaltyPosted).toBe(true);
    expect(mockFolioService.postCharge).toHaveBeenCalledWith(
      'folio-001',
      expect.objectContaining({
        description: 'Cancellation penalty',
        amount: '100.00',
      }),
    );
    expect(result.deposits[0]!.status).toBe('forfeited');
  });
});
