import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  groupProfiles,
  reservations,
  folios,
  charges,
  arLedgers,
  ratePlans,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { CreateGroupProfileDto } from './dto/create-group-profile.dto';
import { UpdateGroupProfileDto } from './dto/update-group-profile.dto';
import { ListGroupProfilesDto } from './dto/list-group-profiles.dto';

@Injectable()
export class GroupProfileService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly folioService: FolioService,
  ) {}

  async createProfile(dto: CreateGroupProfileDto) {
    // Optionally create the master/group folio (KB 14.7). A folio requires a
    // guest, so a billing guest + currency must be supplied to create one.
    let masterFolioId: string | undefined;
    if (dto.createMasterFolio) {
      if (!dto.masterFolioGuestId || !dto.masterFolioCurrencyCode) {
        throw new BadRequestException(
          'masterFolioGuestId and masterFolioCurrencyCode are required to create a master folio',
        );
      }
      const folio = await this.folioService.create({
        propertyId: dto.propertyId,
        guestId: dto.masterFolioGuestId,
        type: 'master',
        currencyCode: dto.masterFolioCurrencyCode,
      });
      masterFolioId = folio.id;
    }

    const [profile] = await this.db
      .insert(groupProfiles)
      .values({
        propertyId: dto.propertyId,
        name: dto.name,
        type: (dto.type as any) ?? 'corporate',
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        billingAddress: dto.billingAddress,
        paymentTermsDays: dto.paymentTermsDays,
        masterFolioId,
        notes: dto.notes,
      })
      .returning();

    await this.webhookService.emit(
      'group.profile_created',
      'group_profile',
      profile.id,
      { name: profile.name, type: profile.type, masterFolioId: profile.masterFolioId },
      profile.propertyId,
    );

    return profile;
  }

  async findProfileById(id: string, propertyId: string) {
    const [profile] = await this.db
      .select()
      .from(groupProfiles)
      .where(and(eq(groupProfiles.id, id), eq(groupProfiles.propertyId, propertyId)));
    if (!profile) {
      throw new NotFoundException(`Group profile ${id} not found`);
    }
    return profile;
  }

  /**
   * Commercial links for a profile: A/R ledgers and negotiated rate plans
   * that reference this group profile (KB 14.3 standing account surfaces).
   */
  async getCommercialLinks(id: string, propertyId: string) {
    const profile = await this.findProfileById(id, propertyId);
    const [ledgers, plans] = await Promise.all([
      this.db
        .select()
        .from(arLedgers)
        .where(
          and(eq(arLedgers.groupProfileId, id), eq(arLedgers.propertyId, propertyId)),
        ),
      this.db
        .select()
        .from(ratePlans)
        .where(
          and(eq(ratePlans.groupProfileId, id), eq(ratePlans.propertyId, propertyId)),
        ),
    ]);
    return {
      profile,
      arLedgers: ledgers,
      ratePlans: plans,
    };
  }

  async listProfiles(dto: ListGroupProfilesDto) {
    const conditions: any[] = [eq(groupProfiles.propertyId, dto.propertyId)];
    if (dto.type) conditions.push(eq(groupProfiles.type, dto.type as any));

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(groupProfiles)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(groupProfiles.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(groupProfiles)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async updateProfile(id: string, propertyId: string, dto: UpdateGroupProfileDto) {
    await this.findProfileById(id, propertyId);
    const [updated] = await this.db
      .update(groupProfiles)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(groupProfiles.id, id), eq(groupProfiles.propertyId, propertyId)))
      .returning();
    return updated;
  }

  /**
   * Link a member reservation to a group profile (KB 14.3). The reservation
   * must belong to the same property — propertyId comes from the request, never
   * inferred from the reservation, to avoid a confused-deputy scoping bypass.
   */
  async linkReservation(profileId: string, propertyId: string, reservationId: string) {
    await this.findProfileById(profileId, propertyId);

    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)),
      );
    if (!reservation) {
      throw new NotFoundException(
        `Reservation ${reservationId} not found at property ${propertyId}`,
      );
    }

    const [updated] = await this.db
      .update(reservations)
      .set({ groupProfileId: profileId, updatedAt: new Date() })
      .where(
        and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)),
      )
      .returning();

    await this.webhookService.emit(
      'group.reservation_linked',
      'group_profile',
      profileId,
      { reservationId },
      propertyId,
    );

    return updated;
  }

  /**
   * Return the master/group folio for a profile (KB 14.7).
   */
  async getGroupFolio(profileId: string, propertyId: string) {
    const profile = await this.findProfileById(profileId, propertyId);
    if (!profile.masterFolioId) {
      throw new NotFoundException(`Group profile ${profileId} has no master folio`);
    }
    return this.folioService.findById(profile.masterFolioId, propertyId);
  }

  /**
   * Generate a computed group invoice from the master folio charges (KB 14.7).
   * Uses its own G- numbering. Does not persist a new table.
   */
  async generateGroupInvoice(profileId: string, propertyId: string) {
    const profile = await this.findProfileById(profileId, propertyId);
    if (!profile.masterFolioId) {
      throw new BadRequestException(
        `Group profile ${profileId} has no master folio to invoice`,
      );
    }
    const folio = await this.folioService.findById(profile.masterFolioId, propertyId);

    const lineItems = await this.db
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.folioId, profile.masterFolioId),
          eq(charges.propertyId, propertyId),
        ),
      )
      .orderBy(charges.serviceDate);

    let subtotal = new Decimal(0);
    let taxTotal = new Decimal(0);
    for (const c of lineItems) {
      subtotal = subtotal.plus(new Decimal(c.amount));
      taxTotal = taxTotal.plus(new Decimal(c.taxAmount ?? '0'));
    }
    const total = subtotal.plus(taxTotal);

    const invoiceNumber = await this.generateInvoiceNumber(propertyId);

    return {
      invoiceNumber,
      groupProfileId: profileId,
      groupName: profile.name,
      masterFolioId: profile.masterFolioId,
      folioNumber: folio.folioNumber,
      currencyCode: folio.currencyCode,
      lineItems: lineItems.map((c: any) => ({
        id: c.id,
        type: c.type,
        description: c.description,
        amount: c.amount,
        taxAmount: c.taxAmount,
        serviceDate: c.serviceDate,
      })),
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      total: total.toFixed(2),
      generatedAt: new Date().toISOString(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async generateInvoiceNumber(_propertyId: string): Promise<string> {
    // Group invoices are computed (not persisted), so the reference is built
    // from the date plus a timestamp-derived sequence — mirrors the prefix+
    // sequence shape of folio.generateFolioNumber without a backing table.
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prefix = `G-${yy}${mm}${dd}`;
    const seq = Number(now.getTime().toString().slice(-4));
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }
}
