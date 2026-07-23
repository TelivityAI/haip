import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RatePlanService } from './rate-plan.service';
import { DRIZZLE } from '../../database/database.module';

const mockBarRate = {
  id: 'rp-bar-001',
  propertyId: 'prop-001',
  roomTypeId: 'rt-001',
  name: 'Best Available Rate',
  code: 'BAR1',
  type: 'bar',
  baseAmount: '200.00',
  currencyCode: 'USD',
  parentRatePlanId: null,
  derivedAdjustmentType: null,
  derivedAdjustmentValue: null,
  isTaxInclusive: false,
  isActive: true,
};

const mockDerivedRate = {
  id: 'rp-aaa-001',
  propertyId: 'prop-001',
  roomTypeId: 'rt-001',
  name: 'AAA Discount',
  code: 'AAA',
  type: 'derived',
  baseAmount: '200.00',
  currencyCode: 'USD',
  parentRatePlanId: 'rp-bar-001',
  derivedAdjustmentType: 'percentage',
  derivedAdjustmentValue: '-10.00',
  isTaxInclusive: false,
  isActive: true,
};

describe('RatePlanService', () => {
  describe('calculateDerivedRate', () => {
    it('should return base amount for non-derived rate', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockBarRate]),
            }),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RatePlanService,
          { provide: DRIZZLE, useValue: mockDb },
        ],
      }).compile();
      const service = module.get<RatePlanService>(RatePlanService);

      const result = await service.calculateDerivedRate('rp-bar-001', 'prop-001');
      expect(result.effectiveRate).toBe(200);
      expect(result.currency).toBe('USD');
    });

    it('should apply percentage discount for derived rate', async () => {
      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                callCount++;
                // First call: derived rate, second call: parent rate
                resolve(callCount === 1 ? [mockDerivedRate] : [mockBarRate]);
              },
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RatePlanService,
          { provide: DRIZZLE, useValue: mockDb },
        ],
      }).compile();
      const service = module.get<RatePlanService>(RatePlanService);

      const result = await service.calculateDerivedRate('rp-aaa-001', 'prop-001');
      // 200 * (1 + (-10/100)) = 200 * 0.9 = 180
      expect(result.effectiveRate).toBe(180);
      expect(result.currency).toBe('USD');
    });

    it('should apply fixed discount for derived rate', async () => {
      const fixedDerived = {
        ...mockDerivedRate,
        derivedAdjustmentType: 'fixed',
        derivedAdjustmentValue: '-25.00',
      };

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                callCount++;
                resolve(callCount === 1 ? [fixedDerived] : [mockBarRate]);
              },
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RatePlanService,
          { provide: DRIZZLE, useValue: mockDb },
        ],
      }).compile();
      const service = module.get<RatePlanService>(RatePlanService);

      const result = await service.calculateDerivedRate('rp-fixed-001', 'prop-001');
      // 200 + (-25) = 175
      expect(result.effectiveRate).toBe(175);
    });

    it('should not return negative rates', async () => {
      const bigDiscount = {
        ...mockDerivedRate,
        derivedAdjustmentType: 'fixed',
        derivedAdjustmentValue: '-300.00',
      };

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                callCount++;
                resolve(callCount === 1 ? [bigDiscount] : [mockBarRate]);
              },
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RatePlanService,
          { provide: DRIZZLE, useValue: mockDb },
        ],
      }).compile();
      const service = module.get<RatePlanService>(RatePlanService);

      const result = await service.calculateDerivedRate('rp-big-001', 'prop-001');
      expect(result.effectiveRate).toBe(0);
    });

    it('should apply LOS adjustment when nights provided', async () => {
      const losPlan = {
        ...mockBarRate,
        losAdjustments: [
          { minNights: 7, adjustmentType: 'percentage', adjustmentValue: -10 },
          { minNights: 14, adjustmentType: 'percentage', adjustmentValue: -15 },
        ],
      };
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([losPlan]),
            }),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RatePlanService,
          { provide: DRIZZLE, useValue: mockDb },
        ],
      }).compile();
      const service = module.get<RatePlanService>(RatePlanService);

      const shortStay = await service.calculateDerivedRate('rp-bar-001', 'prop-001', { nights: 3 });
      expect(shortStay.effectiveRate).toBe(200);
      expect(shortStay.losAdjustment).toBeNull();

      const weekStay = await service.calculateDerivedRate('rp-bar-001', 'prop-001', { nights: 7 });
      expect(weekStay.effectiveRate).toBe(180);
      expect(weekStay.losAdjustment?.minNights).toBe(7);

      const twoWeeks = await service.calculateDerivedRate('rp-bar-001', 'prop-001', { nights: 14 });
      expect(twoWeeks.effectiveRate).toBe(170);
      expect(twoWeeks.losAdjustment?.minNights).toBe(14);
    });

    it('should apply occupancy band when stayDate provided', async () => {
      const occPlan = {
        ...mockBarRate,
        occupancyBands: [
          { occupancyPctMin: 0, occupancyPctMax: 60, adjustmentType: 'percentage', adjustmentValue: -5 },
          { occupancyPctMin: 61, occupancyPctMax: 100, adjustmentType: 'percentage', adjustmentValue: 10 },
        ],
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([occPlan]),
            }),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RatePlanService,
          { provide: DRIZZLE, useValue: mockDb },
        ],
      }).compile();
      const service = module.get<RatePlanService>(RatePlanService);
      vi.spyOn(service, 'getStayOccupancyPct').mockResolvedValue(80);

      const result = await service.calculateDerivedRate('rp-bar-001', 'prop-001', {
        stayDate: '2026-08-15',
      });
      expect(result.effectiveRate).toBe(220);
      expect(result.occupancyPct).toBe(80);
      expect(result.occupancyAdjustment?.adjustmentValue).toBe(10);
    });
  });

  describe('create', () => {
    it('should reject derived rate without parent', async () => {
      const mockDb = {
        // FK ownership check on roomTypes now runs first — return a row so
        // we proceed to the derived-without-parent BadRequest path.
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 'rt-001' }]),
          }),
        }),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RatePlanService,
          { provide: DRIZZLE, useValue: mockDb },
        ],
      }).compile();
      const service = module.get<RatePlanService>(RatePlanService);

      await expect(
        service.create({
          propertyId: 'prop-001',
          roomTypeId: 'rt-001',
          name: 'Bad Derived',
          code: 'BAD',
          type: 'derived',
          baseAmount: '100.00',
          currencyCode: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
