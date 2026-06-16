import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, ilike, or, and, sql, inArray } from 'drizzle-orm';
import { guests, reservations, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { CreateGuestDto } from './dto/create-guest.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';
import { SearchGuestsDto } from './dto/search-guests.dto';

/**
 * GuestService
 *
 * Multi-tenancy note: guests are cross-property by design (one person may stay
 * at multiple hotels), but API access MUST verify a reservation link at the
 * requesting property — otherwise staff at hotel A can read/modify guest PII
 * belonging to hotel B's customers. Every read/update/delete is scoped by
 * "has this guest at least one reservation at `propertyId`?".
 *
 * The one exception is `create()`: a brand-new walk-in has no reservation yet,
 * so creation is NOT scoped by an existing link. The caller still passes its
 * own `propertyId` for audit purposes. Callers that need "find existing guest
 * by email before creating" should expose a dedicated lookup rather than
 * searching unscoped.
 */
@Injectable()
export class GuestService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Verify that a guest has at least one reservation at the given property.
   * Throws NotFoundException if they don't — identical response to "no such
   * guest" to avoid leaking cross-property existence.
   */
  private async assertGuestAtProperty(guestId: string, propertyId: string): Promise<void> {
    const hasStayed = await this.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.guestId, guestId),
          eq(reservations.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!hasStayed.length) {
      throw new NotFoundException(`Guest ${guestId} not found`);
    }
  }

  async create(dto: CreateGuestDto) {
    const values: Record<string, unknown> = { ...dto };
    if (dto.gdprConsentMarketing) {
      values['gdprConsentDate'] = new Date();
    }
    const [guest] = await this.db.insert(guests).values(values).returning();
    return guest;
  }

  async findById(id: string, propertyId: string) {
    await this.assertGuestAtProperty(id, propertyId);
    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, id));
    if (!guest) {
      throw new NotFoundException(`Guest ${id} not found`);
    }
    // Bug 4: after GDPR erasure, treat the guest as not found. Booking history
    // remains but the profile is tombstoned — returning anonymized PII here
    // would leak the fact that the user once existed (and the decision we made).
    if (guest.isDeleted) {
      throw new NotFoundException(`Guest ${id} not found`);
    }
    return guest;
  }

  async update(id: string, propertyId: string, dto: UpdateGuestDto) {
    await this.assertGuestAtProperty(id, propertyId);
    // Bug 4: once erased, treat the row as gone.
    const [existing] = await this.db
      .select({ isDeleted: guests.isDeleted })
      .from(guests)
      .where(eq(guests.id, id));
    if (existing?.isDeleted) {
      throw new NotFoundException(`Guest ${id} not found`);
    }
    const values: Record<string, unknown> = { ...dto, updatedAt: new Date() };
    if (dto.isDnr === true && !dto.dnrReason) {
      // Keep existing reason if not provided
    }
    if (dto.isDnr === true) {
      values['dnrDate'] = new Date();
    }
    if (dto.isDnr === false) {
      values['dnrReason'] = null;
      values['dnrDate'] = null;
    }
    if (dto.gdprConsentMarketing !== undefined) {
      values['gdprConsentDate'] = dto.gdprConsentMarketing ? new Date() : null;
    }

    const [guest] = await this.db
      .update(guests)
      .set(values)
      .where(eq(guests.id, id))
      .returning();
    if (!guest) {
      throw new NotFoundException(`Guest ${id} not found`);
    }
    return guest;
  }

  async delete(id: string, propertyId: string, actor?: AuditActor) {
    // Bug 4: GDPR right-to-erasure. Hard DELETE fails on FK constraints from
    // bookings.guest_id / reservations.guest_id (operational/legal retention
    // requires we keep stay history). Instead, anonymize PII in place and
    // flip isDeleted. findById/update below treat isDeleted=true as 404.
    await this.assertGuestAtProperty(id, propertyId);

    const now = new Date();
    const [anonymized] = await this.db
      .update(guests)
      .set({
        email: `anon+${id}@deleted.local`,
        firstName: 'Deleted',
        lastName: 'User',
        phone: null,
        dateOfBirth: null,
        idType: null,
        idNumber: null,
        idCountry: null,
        idExpiry: null,
        nationality: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        stateProvince: null,
        postalCode: null,
        countryCode: null,
        companyName: null,
        loyaltyNumber: null,
        notes: null,
        preferences: {},
        dnrReason: null,
        gdprConsentMarketing: false,
        gdprConsentDate: null,
        isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(guests.id, id))
      .returning();

    if (!anonymized) {
      throw new NotFoundException(`Guest ${id} not found`);
    }

    // Write an audit log WITHOUT the previous PII — including it would defeat
    // the erasure. Record just that the erasure happened, who, and why.
    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'delete',
      entityType: 'guest',
      entityId: id,
      description: 'gdpr_erasure',
      ...actorFields(actor),
    });

    return { deleted: true };
  }

  async search(propertyId: string, dto: SearchGuestsDto) {
    // Scope to guests with ≥1 reservation at this property.
    // Subquery: distinct guest_id from reservations where property_id = $1.
    // Bug 4: also exclude GDPR-erased guests from search results.
    const conditions: any[] = [
      eq(guests.isDeleted, false),
      inArray(
        guests.id,
        this.db
          .select({ guestId: reservations.guestId })
          .from(reservations)
          .where(eq(reservations.propertyId, propertyId)),
      ),
    ];

    if (dto.search) {
      const pattern = `%${dto.search}%`;
      conditions.push(
        or(
          ilike(guests.firstName, pattern),
          ilike(guests.lastName, pattern),
          ilike(guests.email, pattern),
          ilike(guests.phone, pattern),
        ),
      );
    }

    if (dto.loyaltyNumber) {
      conditions.push(eq(guests.loyaltyNumber, dto.loyaltyNumber));
    }

    if (dto.vipLevel) {
      conditions.push(eq(guests.vipLevel, dto.vipLevel as any));
    }

    if (dto.isDnr !== undefined) {
      conditions.push(eq(guests.isDnr, dto.isDnr));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(guests)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(guests.lastName, guests.firstName),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(guests)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }
}
