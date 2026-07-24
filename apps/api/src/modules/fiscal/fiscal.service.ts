import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  properties,
  reservations,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { FiscalDocumentService } from '../folio/fiscal-document.service';
import { FiscalProviderFactory } from './fiscal-provider.factory';
import type { SetFiscalConfigDto } from './dto/fiscal-config.dto';

type FiscalSettings = {
  fiscal?: {
    providerKey?: string | null;
    config?: Record<string, unknown>;
    documentType?: string | null;
  };
  guestRegistration?: {
    providerKey?: string | null;
    config?: Record<string, unknown>;
  };
};

export type FiscalConfig = {
  propertyId: string;
  fiscalProviderKey: string | null;
  fiscalConfig: Record<string, unknown>;
  documentType: string | null;
  guestRegistrationProviderKey: string | null;
  guestRegistrationConfig: Record<string, unknown>;
};

@Injectable()
export class FiscalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly providerFactory: FiscalProviderFactory,
    private readonly fiscalDocumentService: FiscalDocumentService,
  ) {}

  async getConfig(propertyId: string): Promise<FiscalConfig> {
    const property = await this.findProperty(propertyId);
    return this.toConfig(propertyId, property.settings);
  }

  async setConfig(propertyId: string, dto: SetFiscalConfigDto): Promise<FiscalConfig> {
    if (
      dto.fiscalProviderKey &&
      !this.providerFactory.getFiscalProvider(dto.fiscalProviderKey)
    ) {
      throw new BadRequestException(`Fiscal provider ${dto.fiscalProviderKey} is not registered`);
    }
    if (
      dto.guestRegistrationProviderKey &&
      !this.providerFactory.getGuestRegistrationProvider(dto.guestRegistrationProviderKey)
    ) {
      throw new BadRequestException(
        `Guest-registration provider ${dto.guestRegistrationProviderKey} is not registered`,
      );
    }

    const property = await this.findProperty(propertyId);
    const currentSettings = asRecord(property.settings);
    const previousConfig = this.toConfig(propertyId, currentSettings);
    const nextSettings = this.mergeSettings(currentSettings, dto);

    const [updated] = await this.db
      .update(properties)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(properties.id, propertyId))
      .returning();
    if (!updated) {
      throw new NotFoundException(`Property ${propertyId} not found`);
    }

    const nextConfig = this.toConfig(propertyId, updated.settings);
    await this.auditConfigChange(propertyId, previousConfig, nextConfig);
    return nextConfig;
  }

  async processInvoiceRequested(
    propertyId: string,
    fiscalDocumentId: string,
    eventData: Record<string, unknown> = {},
  ) {
    const config = await this.getConfig(propertyId);
    const provider = this.providerFactory.getFiscalProvider(config.fiscalProviderKey);
    if (!provider) {
      return { skipped: true, reason: 'no_fiscal_provider' };
    }

    const folioId = typeof eventData.folioId === 'string' ? eventData.folioId : null;
    if (!folioId) {
      return { skipped: true, reason: 'missing_folio_id' };
    }

    const documentType =
      (typeof eventData.documentType === 'string' && eventData.documentType.length > 0
        ? eventData.documentType
        : null) ??
      config.documentType ??
      provider.key;

    const ack = await provider.signOrReport({
      propertyId,
      folioId,
      fiscalDocumentId,
      documentType,
      sourceEvent: 'invoice.requested',
      config: config.fiscalConfig,
      eventData,
    });

    const document = await this.fiscalDocumentService.issue(folioId, fiscalDocumentId, {
      propertyId,
      documentNumber: ack.externalId,
      metadata: {
        providerKey: provider.key,
        sourceEvent: 'invoice.requested',
        rawAck: ack.rawAck ?? null,
      },
    });

    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'fiscal_document',
      entityId: fiscalDocumentId,
      description: 'Fiscal provider issued document after invoice.requested',
      newValue: {
        folioId,
        providerKey: provider.key,
        externalId: ack.externalId,
      },
    });

    return { skipped: false, document, ack };
  }

  async reportReservationCheckIn(
    propertyId: string,
    reservationId: string,
    eventData: Record<string, unknown> = {},
  ) {
    return this.reportGuestRegistration(
      propertyId,
      reservationId,
      'check_in',
      'reservation.checked_in',
      eventData,
    );
  }

  async reportReservationCheckOut(
    propertyId: string,
    reservationId: string,
    eventData: Record<string, unknown> = {},
  ) {
    return this.reportGuestRegistration(
      propertyId,
      reservationId,
      'check_out',
      'reservation.checked_out',
      eventData,
    );
  }

  private async reportGuestRegistration(
    propertyId: string,
    reservationId: string,
    operation: 'check_in' | 'check_out',
    sourceEvent: 'reservation.checked_in' | 'reservation.checked_out',
    eventData: Record<string, unknown>,
  ) {
    const config = await this.getConfig(propertyId);
    const provider = this.providerFactory.getGuestRegistrationProvider(
      config.guestRegistrationProviderKey,
    );
    if (!provider) {
      return { skipped: true, reason: 'no_guest_registration_provider' };
    }

    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    if (!reservation) {
      return { skipped: true, reason: 'reservation_not_found' };
    }

    const input = {
      propertyId,
      reservationId,
      guestId: reservation.guestId ?? null,
      roomId: reservation.roomId ?? null,
      sourceEvent,
      config: config.guestRegistrationConfig,
      eventData,
    };
    const ack =
      operation === 'check_in'
        ? await provider.reportCheckIn(input)
        : await provider.reportCheckOut(input);

    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'create',
      entityType: 'guest_registration_report',
      entityId: reservationId,
      description: `Guest-registration ${operation} reported through provider`,
      newValue: {
        reservationId,
        providerKey: provider.key,
        operation,
        externalId: ack.externalId,
        rawAck: ack.rawAck ?? null,
      },
    });

    return { skipped: false, ack };
  }

  private async findProperty(propertyId: string) {
    const [property] = await this.db
      .select({ id: properties.id, settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId));
    if (!property) {
      throw new NotFoundException(`Property ${propertyId} not found`);
    }
    return property;
  }

  private mergeSettings(
    currentSettings: Record<string, unknown>,
    dto: SetFiscalConfigDto,
  ): FiscalSettings & Record<string, unknown> {
    const currentFiscal = asRecord(currentSettings['fiscal']);
    const currentGuestRegistration = asRecord(currentSettings['guestRegistration']);

    const fiscal = { ...currentFiscal };
    if (dto.fiscalProviderKey !== undefined) fiscal['providerKey'] = dto.fiscalProviderKey;
    if (dto.fiscalConfig !== undefined) fiscal['config'] = dto.fiscalConfig;
    if (dto.documentType !== undefined) fiscal['documentType'] = dto.documentType;

    const guestRegistration = { ...currentGuestRegistration };
    if (dto.guestRegistrationProviderKey !== undefined) {
      guestRegistration['providerKey'] = dto.guestRegistrationProviderKey;
    }
    if (dto.guestRegistrationConfig !== undefined) {
      guestRegistration['config'] = dto.guestRegistrationConfig;
    }

    return {
      ...currentSettings,
      fiscal,
      guestRegistration,
    };
  }

  private toConfig(propertyId: string, settings: unknown): FiscalConfig {
    const root = asRecord(settings);
    const fiscal = asRecord(root['fiscal']);
    const guestRegistration = asRecord(root['guestRegistration']);
    return {
      propertyId,
      fiscalProviderKey: nullableString(fiscal['providerKey']),
      fiscalConfig: asRecord(fiscal['config']),
      documentType: nullableString(fiscal['documentType']),
      guestRegistrationProviderKey: nullableString(guestRegistration['providerKey']),
      guestRegistrationConfig: asRecord(guestRegistration['config']),
    };
  }

  private async auditConfigChange(
    propertyId: string,
    previousConfig: FiscalConfig,
    nextConfig: FiscalConfig,
  ) {
    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'property_fiscal_config',
      entityId: propertyId,
      description: 'Fiscal and guest-registration provider config updated',
      previousValue: previousConfig,
      newValue: nextConfig,
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
