import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';

describe('PolicyService', () => {
  let service: PolicyService;
  let db: any;
  const mockWebhook = { emit: vi.fn().mockResolvedValue(undefined) };

  const flexiblePolicy = {
    id: 'policy-flex',
    propertyId: 'prop-001',
    name: 'Flexible',
    code: 'FLEX-24',
    description: 'Free cancellation up to 24 hours before check-in. First night charge after.',
    freeCancelHoursBeforeArrival: 24,
    penaltyType: 'first_night',
    penaltyPercentage: null,
    depositHandling: 'refund_if_refundable',
    isActive: true,
  };

  const nonRefundablePolicy = {
    id: 'policy-nr',
    propertyId: 'prop-001',
    name: 'Non-refundable',
    code: 'NRFN',
    description: 'Non-refundable — full charge applies.',
    freeCancelHoursBeforeArrival: 0,
    penaltyType: 'full',
    penaltyPercentage: null,
    depositHandling: 'always_forfeit',
    isActive: true,
  };

  const percentagePolicy = {
    id: 'policy-pct',
    propertyId: 'prop-001',
    name: 'Fifty',
    code: 'PCT50',
    description: '50% after free window',
    freeCancelHoursBeforeArrival: 24,
    penaltyType: 'percentage',
    penaltyPercentage: '50.00',
    depositHandling: 'refund_if_refundable',
    isActive: true,
  };

  function selectResult(rows: any[]) {
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(rows),
          }),
        }),
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = {
      select: vi.fn().mockReturnValue(selectResult([])),
      insert: vi.fn(),
      update: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: mockWebhook },
      ],
    }).compile();

    service = module.get(PolicyService);
  });

  describe('create', () => {
    it('requires penaltyPercentage when penaltyType is percentage', async () => {
      await expect(
        service.create({
          propertyId: 'prop-001',
          name: 'Bad',
          code: 'BAD',
          penaltyType: 'percentage',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates and emits webhook', async () => {
      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([flexiblePolicy]),
        }),
      });
      const row = await service.create({
        propertyId: 'prop-001',
        name: 'Flexible',
        code: 'FLEX-24',
      });
      expect(row.code).toBe('FLEX-24');
      expect(mockWebhook.emit).toHaveBeenCalledWith(
        'cancellation_policy.created',
        'cancellation_policy',
        'policy-flex',
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('findById', () => {
    it('scopes by propertyId', async () => {
      db.select.mockReturnValue(selectResult([]));
      await expect(service.findById('policy-flex', 'prop-other')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('evaluateCancellation', () => {
    function mockRatePlanWithPolicy(policy: any | null, ratePlanId = 'rate-001') {
      const ratePlan = {
        id: ratePlanId,
        propertyId: 'prop-001',
        cancellationPolicyId: policy?.id ?? null,
      };
      let call = 0;
      db.select.mockImplementation(() => {
        call += 1;
        if (call === 1) return selectResult([ratePlan]);
        if (policy) return selectResult([policy]);
        return selectResult([]);
      });
    }

    it('inside free window: zero penalty and refund deposit action', async () => {
      mockRatePlanWithPolicy(flexiblePolicy);
      const arrival = new Date();
      arrival.setUTCDate(arrival.getUTCDate() + 10);
      const arrivalDate = arrival.toISOString().slice(0, 10);

      const result = await service.evaluateCancellation({
        propertyId: 'prop-001',
        ratePlanId: 'rate-001',
        arrivalDate,
        totalAmount: '300.00',
        nights: 3,
      });

      expect(result.withinFreeWindow).toBe(true);
      expect(result.penaltyAmount).toBe('0.00');
      expect(result.depositAction).toBe('refund');
    });

    it('outside free window: first_night penalty', async () => {
      mockRatePlanWithPolicy(flexiblePolicy);
      const arrival = new Date();
      arrival.setUTCDate(arrival.getUTCDate() + 0);
      const arrivalDate = arrival.toISOString().slice(0, 10);

      const result = await service.evaluateCancellation({
        propertyId: 'prop-001',
        ratePlanId: 'rate-001',
        arrivalDate,
        totalAmount: '300.00',
        nights: 3,
        now: new Date(`${arrivalDate}T14:00:00Z`),
      });

      expect(result.withinFreeWindow).toBe(false);
      expect(result.penaltyAmount).toBe('100.00');
      expect(result.depositAction).toBe('forfeit');
    });

    it('percentage penalty outside window', async () => {
      mockRatePlanWithPolicy(percentagePolicy);
      const result = await service.evaluateCancellation({
        propertyId: 'prop-001',
        ratePlanId: 'rate-001',
        arrivalDate: '2020-01-01',
        totalAmount: '200.00',
        nights: 2,
        now: new Date('2020-01-01T14:00:00Z'),
      });
      expect(result.penaltyAmount).toBe('100.00');
      expect(result.depositAction).toBe('forfeit');
    });

    it('full / always_forfeit non-refundable', async () => {
      mockRatePlanWithPolicy(nonRefundablePolicy);
      const arrival = new Date();
      arrival.setUTCDate(arrival.getUTCDate() + 30);
      const arrivalDate = arrival.toISOString().slice(0, 10);

      const result = await service.evaluateCancellation({
        propertyId: 'prop-001',
        ratePlanId: 'rate-001',
        arrivalDate,
        totalAmount: '500.00',
        nights: 2,
      });

      expect(result.withinFreeWindow).toBe(false);
      expect(result.penaltyAmount).toBe('500.00');
      expect(result.depositAction).toBe('forfeit');
    });

    it('uses default heuristic when rate plan has no policy', async () => {
      mockRatePlanWithPolicy(null);
      const arrival = new Date();
      arrival.setUTCDate(arrival.getUTCDate() + 10);
      const arrivalDate = arrival.toISOString().slice(0, 10);

      const result = await service.evaluateCancellation({
        propertyId: 'prop-001',
        ratePlanId: 'rate-001',
        arrivalDate,
        totalAmount: '100.00',
        nights: 1,
      });

      expect(result.withinFreeWindow).toBe(true);
      expect(result.penaltyAmount).toBe('0.00');
      expect(result.policyId).toBeNull();
    });
  });
});
