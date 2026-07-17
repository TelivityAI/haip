import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { fiscalDocuments, folios } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import type {
  RequestFiscalDocumentDto,
  IssueFiscalDocumentDto,
  VoidFiscalDocumentDto,
} from './dto/fiscal-document.dto';

/**
 * Fiscal documents — official tax document references on a folio.
 *
 * Core owns only the lifecycle (requested → issued → voided) and the emitted
 * invoice.* events. The actual issuance against a government/tax authority is
 * done by an EXTERNAL integration subscribed to `invoice.requested`, which
 * reports the result back through `issue()` / `void()`. No regional tax logic
 * lives here — regional fields go in `metadata`.
 */
@Injectable()
export class FiscalDocumentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  /**
   * Request a fiscal document for a folio. Emits `invoice.requested` so a
   * subscribed integration can perform the issuance.
   */
  async request(folioId: string, dto: RequestFiscalDocumentDto) {
    const folio = await this.findFolio(folioId, dto.propertyId);

    const [doc] = await this.db
      .insert(fiscalDocuments)
      .values({
        propertyId: dto.propertyId,
        folioId,
        documentType: dto.documentType,
        status: 'requested',
        metadata: dto.metadata ?? null,
      })
      .returning();

    await this.webhookService.emit(
      'invoice.requested',
      'fiscal_document',
      doc.id,
      {
        folioId,
        folioNumber: folio.folioNumber,
        documentType: doc.documentType,
      },
      dto.propertyId,
    );

    return doc;
  }

  /**
   * Record the issued document reference (called by the integration once the
   * external issuer accepted the document). Emits `invoice.issued`.
   */
  async issue(folioId: string, documentId: string, dto: IssueFiscalDocumentDto) {
    const doc = await this.findDocument(documentId, folioId, dto.propertyId);
    if (doc.status !== 'requested') {
      throw new BadRequestException(
        `Fiscal document ${documentId} is ${doc.status}; only requested documents can be issued`,
      );
    }

    const [updated] = await this.db
      .update(fiscalDocuments)
      .set({
        status: 'issued',
        documentNumber: dto.documentNumber,
        documentUrl: dto.documentUrl ?? null,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : new Date(),
        // Merge so request-time metadata survives issuance.
        metadata: { ...(doc.metadata ?? {}), ...(dto.metadata ?? {}) },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fiscalDocuments.id, documentId),
          eq(fiscalDocuments.propertyId, dto.propertyId),
        ),
      )
      .returning();

    await this.webhookService.emit(
      'invoice.issued',
      'fiscal_document',
      updated.id,
      {
        folioId,
        documentType: updated.documentType,
        documentNumber: updated.documentNumber,
      },
      dto.propertyId,
    );

    return updated;
  }

  /**
   * Void a fiscal document — either cancelling a pending request or voiding
   * an already-issued document. Emits `invoice.voided`.
   */
  async void(folioId: string, documentId: string, dto: VoidFiscalDocumentDto) {
    const doc = await this.findDocument(documentId, folioId, dto.propertyId);
    if (doc.status === 'voided') {
      throw new BadRequestException(`Fiscal document ${documentId} is already voided`);
    }

    const [updated] = await this.db
      .update(fiscalDocuments)
      .set({
        status: 'voided',
        voidedAt: new Date(),
        voidReason: dto.reason ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fiscalDocuments.id, documentId),
          eq(fiscalDocuments.propertyId, dto.propertyId),
        ),
      )
      .returning();

    await this.webhookService.emit(
      'invoice.voided',
      'fiscal_document',
      updated.id,
      {
        folioId,
        documentType: updated.documentType,
        documentNumber: updated.documentNumber,
      },
      dto.propertyId,
    );

    return updated;
  }

  async list(folioId: string, propertyId: string) {
    await this.findFolio(folioId, propertyId);
    return this.db
      .select()
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.folioId, folioId),
          eq(fiscalDocuments.propertyId, propertyId),
        ),
      )
      .orderBy(desc(fiscalDocuments.createdAt));
  }

  private async findFolio(folioId: string, propertyId: string) {
    const [folio] = await this.db
      .select()
      .from(folios)
      .where(and(eq(folios.id, folioId), eq(folios.propertyId, propertyId)));
    if (!folio) {
      throw new NotFoundException(`Folio ${folioId} not found`);
    }
    return folio;
  }

  private async findDocument(documentId: string, folioId: string, propertyId: string) {
    const [doc] = await this.db
      .select()
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.id, documentId),
          eq(fiscalDocuments.folioId, folioId),
          eq(fiscalDocuments.propertyId, propertyId),
        ),
      );
    if (!doc) {
      throw new NotFoundException(`Fiscal document ${documentId} not found`);
    }
    return doc;
  }
}
