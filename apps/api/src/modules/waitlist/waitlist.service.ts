import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  ratePlans,
  roomTypes,
  waitlistEntries,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { AvailabilityService } from '../reservation/availability.service';
import {
  CreateWaitlistEntryDto,
  ListWaitlistEntriesDto,
  OfferWaitlistEntryDto,
  UpdateWaitlistEntryDto,
} from './dto/waitlist.dto';

@Injectable()
export class WaitlistService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async create(dto: CreateWaitlistEntryDto) {
    this.assertDateRange(dto.arrivalDate, dto.departureDate);
    if (dto.roomTypeId) {
      await this.assertPropertyFk(roomTypes, dto.roomTypeId, dto.propertyId, 'room type');
    }
    if (dto.ratePlanId) {
      await this.assertPropertyFk(ratePlans, dto.ratePlanId, dto.propertyId, 'rate plan');
    }

    const [entry] = await this.db
      .insert(waitlistEntries)
      .values({
        propertyId: dto.propertyId,
        status: 'active',
        arrivalDate: dto.arrivalDate,
        departureDate: dto.departureDate,
        roomsRequested: dto.roomsRequested ?? 1,
        adults: dto.adults ?? 1,
        children: dto.children ?? 0,
        roomTypeId: dto.roomTypeId,
        ratePlanId: dto.ratePlanId,
        priority: dto.priority ?? 0,
        guestName: dto.guestName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        notes: dto.notes,
      })
      .returning();

    return entry;
  }

  async list(dto: ListWaitlistEntriesDto) {
    const conditions: any[] = [eq(waitlistEntries.propertyId, dto.propertyId)];
    if (dto.status) conditions.push(eq(waitlistEntries.status, dto.status));

    return this.db
      .select()
      .from(waitlistEntries)
      .where(and(...conditions))
      .orderBy(desc(waitlistEntries.createdAt));
  }

  async findById(id: string, propertyId: string) {
    const [entry] = await this.db
      .select()
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.propertyId, propertyId)));
    if (!entry) {
      throw new NotFoundException(`Waitlist entry ${id} not found`);
    }
    return entry;
  }

  async update(id: string, propertyId: string, dto: UpdateWaitlistEntryDto) {
    const existing = await this.findById(id, propertyId);
    if (!['active', 'offered'].includes(existing.status)) {
      throw new BadRequestException('Only active/offered waitlist entries can be updated');
    }

    const arrivalDate = dto.arrivalDate ?? existing.arrivalDate;
    const departureDate = dto.departureDate ?? existing.departureDate;
    this.assertDateRange(arrivalDate, departureDate);

    if (dto.roomTypeId) {
      await this.assertPropertyFk(roomTypes, dto.roomTypeId, propertyId, 'room type');
    }
    if (dto.ratePlanId) {
      await this.assertPropertyFk(ratePlans, dto.ratePlanId, propertyId, 'rate plan');
    }

    const [entry] = await this.db
      .update(waitlistEntries)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.propertyId, propertyId)))
      .returning();

    return entry;
  }

  async offer(id: string, propertyId: string, dto: OfferWaitlistEntryDto) {
    const existing = await this.findById(id, propertyId);
    if (existing.status !== 'active') {
      throw new BadRequestException('Only active waitlist entries can be offered');
    }

    const [entry] = await this.db
      .update(waitlistEntries)
      .set({
        status: 'offered',
        offerExpiresAt: dto.offerExpiresAt ? new Date(dto.offerExpiresAt) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.propertyId, propertyId)))
      .returning();

    return entry;
  }

  async cancel(id: string, propertyId: string) {
    const existing = await this.findById(id, propertyId);
    if (!['active', 'offered'].includes(existing.status)) {
      throw new BadRequestException('Only active/offered waitlist entries can be cancelled');
    }

    const [entry] = await this.db
      .update(waitlistEntries)
      .set({
        status: 'cancelled',
        offerExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.propertyId, propertyId)))
      .returning();

    return entry;
  }

  async convert(id: string, propertyId: string) {
    const existing = await this.findById(id, propertyId);
    if (!['active', 'offered'].includes(existing.status)) {
      throw new BadRequestException('Only active/offered waitlist entries can be converted');
    }

    const availability = await this.availabilityService.searchAvailability(
      propertyId,
      existing.arrivalDate,
      existing.departureDate,
      existing.roomTypeId ?? undefined,
    );
    const hasAvailability = availability.some((row) => row.available > 0);
    if (!hasAvailability) {
      throw new BadRequestException('No availability to convert this waitlist entry');
    }

    const [entry] = await this.db
      .update(waitlistEntries)
      .set({
        status: 'converted',
        updatedAt: new Date(),
      })
      .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.propertyId, propertyId)))
      .returning();

    return { entry, needsBooking: true };
  }

  private assertDateRange(arrivalDate: string, departureDate: string) {
    if (new Date(arrivalDate).getTime() >= new Date(departureDate).getTime()) {
      throw new BadRequestException('departureDate must be after arrivalDate');
    }
  }

  private async assertPropertyFk(
    table: { id: any; propertyId: any },
    id: string,
    propertyId: string,
    label: string,
  ) {
    const [row] = await this.db
      .select({ id: table.id })
      .from(table as any)
      .where(and(eq(table.id, id), eq(table.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`${label} ${id} not found in this property`);
    }
  }
}
