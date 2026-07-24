// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { properties, roomTypes } from '@inhotel-io/database';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class ConnectContentService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Get detailed property content for Agent 4.2 (Dedup) and 4.3 (Content Normalization).
   */
  async getPropertyDetail(propertyId: string) {
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new NotFoundException(`Property ${propertyId} not found`);
    }

    const types = await this.db
      .select()
      .from(roomTypes)
      .where(and(eq(roomTypes.propertyId, propertyId), eq(roomTypes.isActive, true)));

    const settings = (property.settings ?? {}) as Record<string, unknown>;

    return {
      sourcePropertyId: property.id,
      propertyName: property.name,
      propertyCode: property.code,
      description: property.description,
      starRating: property.starRating,
      address: {
        street: property.addressLine1,
        city: property.city,
        state: property.stateProvince,
        country: property.countryCode,
        postalCode: property.postalCode,
      },
      contact: {
        phone: property.phone,
        email: property.email,
        website: property.website,
      },
      timezone: property.timezone,
      currencyCode: property.currencyCode,
      totalRooms: property.totalRooms,
      roomTypes: types.map((t: any) => ({
        id: t.id,
        name: t.name,
        code: t.code,
        description: t.description,
        baseOccupancy: t.defaultOccupancy,
        maxOccupancy: t.maxOccupancy,
        maxAdults: t.maxOccupancy,
        maxChildren: Math.max(0, t.maxOccupancy - t.defaultOccupancy),
        bedType: t.bedType,
        isAccessible: t.isAccessible,
        amenities: t.amenities ?? [],
      })),
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      policies: {
        cancellationDefault: 'Varies by rate plan',
        depositRequired: !!(settings['depositPercentage'] && (settings['depositPercentage'] as number) > 0),
      },
    };
  }

  /**
   * List all properties (for Agent 4.2 background sync).
   * Bug 7: paginate at SQL — default page size 50, hard cap 100.
   */
  async listProperties(limit = 50, offset = 0) {
    const effectiveLimit = Math.min(Math.max(limit, 1), 100);
    const effectiveOffset = Math.max(offset, 0);
    const allProperties = await this.db
      .select()
      .from(properties)
      .where(eq(properties.isActive, true))
      .limit(effectiveLimit)
      .offset(effectiveOffset);

    return allProperties.map((p: any) => ({
      sourcePropertyId: p.id,
      propertyName: p.name,
      propertyCode: p.code,
      city: p.city,
      country: p.countryCode,
      starRating: p.starRating,
      totalRooms: p.totalRooms,
    }));
  }
}
