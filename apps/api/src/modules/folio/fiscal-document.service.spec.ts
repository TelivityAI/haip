import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FiscalDocumentService } from './fiscal-document.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockFolio = {
  id: 'folio-001',
  propertyId: 'prop-001',
  folioNumber: 'F-2026-0001',
  status: 'settled',
};

const mockDoc = {
  id: 'fdoc-001',
  propertyId: 'prop-001',
  folioId: 'folio-001',
  documentType: 'nfse',
  status: 'requested',
  documentNumber: null,
  metadata: { municipalCode: '3550308' },
};

/**
 * Table-aware mock: dispatches select() results by pgTable name so folio
 * lookups and fiscal-document lookups can return different rows.
 */
function createMockDb({
  folioRows = [mockFolio],
  docRows = [mockDoc],
  written = [mockDoc],
}: {
  folioRows?: any[];
  docRows?: any[];
  written?: any[];
} = {}) {
  const tableName = (tbl: any) =>
    String(tbl?.[Symbol.for('drizzle:Name')] ?? tbl?._?.name ?? '');

  return {
    select: vi.fn(() => ({
      from: vi.fn((tbl: any) => {
        const rows = tableName(tbl).includes('folios') ? folioRows : docRows;
        const result: any = Promise.resolve(rows);
        result.orderBy = vi.fn().mockResolvedValue(rows);
        return { where: vi.fn(() => result) };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(written),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(written),
        })),
      })),
    })),
  };
}

const mockWebhookService = { emit: vi.fn() };

async function buildService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FiscalDocumentService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<FiscalDocumentService>(FiscalDocumentService);
}

describe('FiscalDocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request', () => {
    it('creates a requested document and emits invoice.requested', async () => {
      const svc = await buildService(createMockDb());
      const result = await svc.request('folio-001', {
        propertyId: 'prop-001',
        documentType: 'nfse',
        metadata: { municipalCode: '3550308' },
      });

      expect(result.status).toBe('requested');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'invoice.requested',
        'fiscal_document',
        mockDoc.id,
        {
          folioId: 'folio-001',
          folioNumber: 'F-2026-0001',
          documentType: 'nfse',
        },
        'prop-001',
      );
    });

    it('throws NotFound when the folio is not at the property (multi-tenancy)', async () => {
      const svc = await buildService(createMockDb({ folioRows: [] }));
      await expect(
        svc.request('folio-001', { propertyId: 'other-prop', documentType: 'nfse' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockWebhookService.emit).not.toHaveBeenCalled();
    });
  });

  describe('issue', () => {
    it('marks a requested document issued and emits invoice.issued', async () => {
      const issued = {
        ...mockDoc,
        status: 'issued',
        documentNumber: '2026-000123',
        issuedAt: new Date(),
      };
      const svc = await buildService(createMockDb({ written: [issued] }));

      const result = await svc.issue('folio-001', 'fdoc-001', {
        propertyId: 'prop-001',
        documentNumber: '2026-000123',
        documentUrl: 'https://issuer.example.gov/doc/123.pdf',
      });

      expect(result.status).toBe('issued');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'invoice.issued',
        'fiscal_document',
        issued.id,
        {
          folioId: 'folio-001',
          documentType: 'nfse',
          documentNumber: '2026-000123',
        },
        'prop-001',
      );
    });

    it('rejects issuing a document that is not in requested state', async () => {
      const alreadyIssued = { ...mockDoc, status: 'issued' };
      const svc = await buildService(createMockDb({ docRows: [alreadyIssued] }));
      await expect(
        svc.issue('folio-001', 'fdoc-001', {
          propertyId: 'prop-001',
          documentNumber: '2026-000124',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockWebhookService.emit).not.toHaveBeenCalled();
    });

    it('throws NotFound when the document is not at the property (multi-tenancy)', async () => {
      const svc = await buildService(createMockDb({ docRows: [] }));
      await expect(
        svc.issue('folio-001', 'fdoc-001', {
          propertyId: 'other-prop',
          documentNumber: '2026-000123',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('void', () => {
    it('voids an issued document and emits invoice.voided', async () => {
      const issued = { ...mockDoc, status: 'issued', documentNumber: '2026-000123' };
      const voided = { ...issued, status: 'voided', voidReason: 'duplicate' };
      const svc = await buildService(
        createMockDb({ docRows: [issued], written: [voided] }),
      );

      const result = await svc.void('folio-001', 'fdoc-001', {
        propertyId: 'prop-001',
        reason: 'duplicate',
      });

      expect(result.status).toBe('voided');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'invoice.voided',
        'fiscal_document',
        voided.id,
        {
          folioId: 'folio-001',
          documentType: 'nfse',
          documentNumber: '2026-000123',
        },
        'prop-001',
      );
    });

    it('rejects voiding an already-voided document', async () => {
      const voided = { ...mockDoc, status: 'voided' };
      const svc = await buildService(createMockDb({ docRows: [voided] }));
      await expect(
        svc.void('folio-001', 'fdoc-001', { propertyId: 'prop-001' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('throws NotFound when the folio is not at the property (multi-tenancy)', async () => {
      const svc = await buildService(createMockDb({ folioRows: [] }));
      await expect(svc.list('folio-001', 'other-prop')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns documents for the folio', async () => {
      const svc = await buildService(createMockDb());
      const rows = await svc.list('folio-001', 'prop-001');
      expect(rows).toEqual([mockDoc]);
    });
  });
});
