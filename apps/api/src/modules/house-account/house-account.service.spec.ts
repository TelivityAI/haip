import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HouseAccountService } from './house-account.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockAccount = {
  id: 'ha-001',
  propertyId: 'prop-001',
  name: 'Lobby Bar',
  kind: 'retail',
  status: 'open',
  balance: '0.00',
  totalCharges: '0.00',
  totalPayments: '0.00',
  currencyCode: 'USD',
  notes: null,
  openedBy: null,
  openedAt: new Date(),
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockProduct = {
  id: 'prod-001',
  propertyId: 'prop-001',
  category: 'Beverages',
  name: 'Bottled Water',
  price: '2.50',
  currencyCode: 'USD',
  taxCode: 'VAT',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function chainResolving(returnData: any[]) {
  return () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(returnData),
          }),
        }),
        then: (resolve: any) => resolve(returnData),
      }),
    }),
  });
}

function mutateResolving(returnData: any[]) {
  return () => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnData),
      }),
    }),
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
  });
}

const mockWebhookService = { emit: vi.fn() };

async function buildService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      HouseAccountService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<HouseAccountService>(HouseAccountService);
}

describe('HouseAccountService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('open', () => {
    it('opens a house account and emits houseaccount.opened', async () => {
      const db = {
        select: vi.fn(),
        insert: vi.fn().mockReturnValue(mutateResolving([mockAccount])()),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.open({
        propertyId: 'prop-001',
        name: 'Lobby Bar',
        currencyCode: 'USD',
      });
      expect(result.status).toBe('open');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'houseaccount.opened',
        'house_account',
        mockAccount.id,
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('findById (multi-tenancy)', () => {
    it('throws NotFound when scoped propertyId does not match (db returns [])', async () => {
      const db = {
        select: vi.fn().mockImplementation(chainResolving([])),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(svc.findById('ha-001', 'other-prop')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('close', () => {
    it('closes an open account and emits houseaccount.closed', async () => {
      const closed = { ...mockAccount, status: 'closed', closedAt: new Date() };
      const db = {
        select: vi.fn().mockImplementation(chainResolving([mockAccount])),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue(mutateResolving([closed])()),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.close('ha-001', 'prop-001');
      expect(result.status).toBe('closed');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'houseaccount.closed',
        'house_account',
        closed.id,
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects closing an already-closed account', async () => {
      const db = {
        select: vi.fn().mockImplementation(chainResolving([{ ...mockAccount, status: 'closed' }])),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(svc.close('ha-001', 'prop-001')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('addCharge', () => {
    it('rejects posting a charge to a closed account', async () => {
      const db = {
        select: vi.fn().mockImplementation(chainResolving([{ ...mockAccount, status: 'closed' }])),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(
        svc.addCharge('ha-001', 'prop-001', {
          propertyId: 'prop-001',
          description: 'Water',
          amount: '5.00',
          currencyCode: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('posts an incidental charge, recalcs balance, and emits houseaccount.charge_posted', async () => {
      const charge = {
        id: 'chg-001',
        houseAccountId: 'ha-001',
        type: 'incidental',
        amount: '5.00',
        description: 'Water',
      };
      // findById (open) -> then chain; recalc selects (charge sum, payment sum)
      const selectImpls = [
        chainResolving([mockAccount])(), // findById in addCharge
        chainResolving([{ total: '5.00' }])(), // charge sum
        chainResolving([{ total: '0.00' }])(), // payment sum
      ];
      let call = 0;
      const db = {
        select: vi.fn().mockImplementation(() => selectImpls[call++] ?? chainResolving([])()),
        insert: vi.fn().mockReturnValue(mutateResolving([charge])()),
        update: vi.fn().mockReturnValue(mutateResolving([mockAccount])()),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.addCharge('ha-001', 'prop-001', {
        propertyId: 'prop-001',
        description: 'Water',
        amount: '5.00',
        currencyCode: 'USD',
      });
      expect(result.amount).toBe('5.00');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'houseaccount.charge_posted',
        'charge',
        'chg-001',
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('sellProduct', () => {
    it('posts a charge for price*quantity and returns a receipt with balance math', async () => {
      const charge = {
        id: 'chg-002',
        houseAccountId: 'ha-001',
        type: 'incidental',
        amount: '5.00',
        description: 'Bottled Water x2',
      };
      const accountAfter = { ...mockAccount, balance: '5.00', totalCharges: '5.00' };
      // select order: sellProduct findById(open), product lookup,
      // then addCharge findById(open), charge sum, payment sum, sellProduct findById(after)
      const selectImpls = [
        chainResolving([mockAccount])(), // sellProduct.findById
        chainResolving([mockProduct])(), // product lookup
        chainResolving([mockAccount])(), // addCharge.findById
        chainResolving([{ total: '5.00' }])(), // charge sum
        chainResolving([{ total: '0.00' }])(), // payment sum
        chainResolving([accountAfter])(), // sellProduct.findById (after)
      ];
      let call = 0;
      const db = {
        select: vi.fn().mockImplementation(() => selectImpls[call++] ?? chainResolving([])()),
        insert: vi.fn().mockReturnValue(mutateResolving([charge])()),
        update: vi.fn().mockReturnValue(mutateResolving([accountAfter])()),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.sellProduct('ha-001', 'prop-001', {
        propertyId: 'prop-001',
        productId: 'prod-001',
        quantity: 2,
      });
      expect(result.lineTotal).toBe('5.00'); // 2.50 * 2
      expect(result.quantity).toBe(2);
      expect(result.balance).toBe('5.00');
      expect(result.payment).toBeNull();
    });

    it('throws NotFound when the product belongs to another property', async () => {
      const selectImpls = [
        chainResolving([mockAccount])(), // findById(open)
        chainResolving([])(), // product lookup -> none
      ];
      let call = 0;
      const db = {
        select: vi.fn().mockImplementation(() => selectImpls[call++] ?? chainResolving([])()),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(
        svc.sellProduct('ha-001', 'prop-001', {
          propertyId: 'prop-001',
          productId: 'prod-001',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createProduct', () => {
    it('creates a product scoped to the property', async () => {
      const db = {
        select: vi.fn(),
        insert: vi.fn().mockReturnValue(mutateResolving([mockProduct])()),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.createProduct({
        propertyId: 'prop-001',
        name: 'Bottled Water',
        price: '2.50',
        currencyCode: 'USD',
      });
      expect(result.name).toBe('Bottled Water');
    });
  });
});
