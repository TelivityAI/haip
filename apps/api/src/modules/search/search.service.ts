import { Injectable, Inject } from '@nestjs/common';
import { eq, and, or, ilike, inArray } from 'drizzle-orm';
import {
  guests,
  reservations,
  bookings,
  folios,
  rooms,
  groupProfiles,
  properties,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

export type SearchResultType = 'guest' | 'reservation' | 'folio' | 'room' | 'group';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  propertyId: string;
  title: string;
  subtitle?: string;
  href: string;
}

const DEFAULT_TYPES: SearchResultType[] = ['guest', 'reservation', 'folio', 'room', 'group'];
const LIMIT_PER_TYPE = 5;

@Injectable()
export class SearchService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async search(propertyId: string, query: string, types?: string): Promise<SearchResult[]> {
    const pattern = `%${query}%`;
    const enabled = types
      ? (types.split(',').map((t) => t.trim()) as SearchResultType[])
      : DEFAULT_TYPES;

    const results: SearchResult[] = [];

    if (enabled.includes('guest')) {
      results.push(...(await this.searchGuests(propertyId, pattern)));
    }
    if (enabled.includes('reservation')) {
      results.push(...(await this.searchReservations(propertyId, pattern)));
    }
    if (enabled.includes('folio')) {
      results.push(...(await this.searchFolios(propertyId, pattern)));
    }
    if (enabled.includes('room')) {
      results.push(...(await this.searchRooms(propertyId, pattern)));
    }
    if (enabled.includes('group')) {
      results.push(...(await this.searchGroups(propertyId, pattern)));
    }

    return results;
  }

  /**
   * Portfolio search fans out across all accessible properties.
   */
  async searchPortfolio(propertyIds: string[], query: string, types?: string): Promise<SearchResult[]> {
    const chunks = await Promise.all(
      propertyIds.map((id) => this.search(id, query, types)),
    );
    return chunks.flat().slice(0, 25);
  }

  private async searchGuests(propertyId: string, pattern: string): Promise<SearchResult[]> {
    const rows = await this.db
      .select({
        id: guests.id,
        firstName: guests.firstName,
        lastName: guests.lastName,
        email: guests.email,
      })
      .from(guests)
      .where(
        and(
          eq(guests.isDeleted, false),
          inArray(
            guests.id,
            this.db
              .select({ guestId: reservations.guestId })
              .from(reservations)
              .where(eq(reservations.propertyId, propertyId)),
          ),
          or(
            ilike(guests.firstName, pattern),
            ilike(guests.lastName, pattern),
            ilike(guests.email, pattern),
            ilike(guests.phone, pattern),
          ),
        ),
      )
      .limit(LIMIT_PER_TYPE);

    return rows.map((g: { id: string; firstName: string; lastName: string; email: string | null }) => ({
      type: 'guest' as const,
      id: g.id,
      propertyId,
      title: `${g.firstName} ${g.lastName}`.trim(),
      subtitle: g.email ?? undefined,
      href: `/guests/${g.id}?propertyId=${propertyId}`,
    }));
  }

  private async searchReservations(propertyId: string, pattern: string): Promise<SearchResult[]> {
    const rows = await this.db
      .select({
        id: reservations.id,
        status: reservations.status,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        confirmationNumber: bookings.confirmationNumber,
        guestFirst: guests.firstName,
        guestLast: guests.lastName,
      })
      .from(reservations)
      .innerJoin(bookings, eq(reservations.bookingId, bookings.id))
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          or(
            ilike(bookings.confirmationNumber, pattern),
            ilike(bookings.externalConfirmation, pattern),
            ilike(guests.firstName, pattern),
            ilike(guests.lastName, pattern),
          ),
        ),
      )
      .limit(LIMIT_PER_TYPE);

    return rows.map((r: {
      id: string;
      status: string;
      arrivalDate: string;
      departureDate: string;
      confirmationNumber: string;
      guestFirst: string;
      guestLast: string;
    }) => ({
      type: 'reservation' as const,
      id: r.id,
      propertyId,
      title: r.confirmationNumber,
      subtitle: `${r.guestFirst} ${r.guestLast} · ${r.arrivalDate} → ${r.departureDate}`,
      href: `/reservations/calendar?propertyId=${propertyId}&highlight=${r.id}`,
    }));
  }

  private async searchFolios(propertyId: string, pattern: string): Promise<SearchResult[]> {
    const rows = await this.db
      .select({
        id: folios.id,
        folioNumber: folios.folioNumber,
        balance: folios.balance,
        guestFirst: guests.firstName,
        guestLast: guests.lastName,
      })
      .from(folios)
      .innerJoin(guests, eq(folios.guestId, guests.id))
      .where(
        and(
          eq(folios.propertyId, propertyId),
          or(
            ilike(folios.folioNumber, pattern),
            ilike(guests.firstName, pattern),
            ilike(guests.lastName, pattern),
          ),
        ),
      )
      .limit(LIMIT_PER_TYPE);

    return rows.map((f: {
      id: string;
      folioNumber: string;
      balance: string;
      guestFirst: string;
      guestLast: string;
    }) => ({
      type: 'folio' as const,
      id: f.id,
      propertyId,
      title: f.folioNumber,
      subtitle: `${f.guestFirst} ${f.guestLast} · Balance ${f.balance}`,
      href: `/folios/${f.id}?propertyId=${propertyId}`,
    }));
  }

  private async searchRooms(propertyId: string, pattern: string): Promise<SearchResult[]> {
    const rows = await this.db
      .select({
        id: rooms.id,
        number: rooms.number,
        status: rooms.status,
      })
      .from(rooms)
      .where(
        and(
          eq(rooms.propertyId, propertyId),
          eq(rooms.isActive, true),
          ilike(rooms.number, pattern),
        ),
      )
      .limit(LIMIT_PER_TYPE);

    return rows.map((r: { id: string; number: string; status: string }) => ({
      type: 'room' as const,
      id: r.id,
      propertyId,
      title: `Room ${r.number}`,
      subtitle: r.status.replace(/_/g, ' '),
      href: `/rooms?propertyId=${propertyId}&highlight=${r.id}`,
    }));
  }

  private async searchGroups(propertyId: string, pattern: string): Promise<SearchResult[]> {
    const rows = await this.db
      .select({
        id: groupProfiles.id,
        name: groupProfiles.name,
        groupType: groupProfiles.groupType,
      })
      .from(groupProfiles)
      .where(
        and(
          eq(groupProfiles.propertyId, propertyId),
          or(
            ilike(groupProfiles.name, pattern),
            ilike(groupProfiles.contactName, pattern),
          ),
        ),
      )
      .limit(LIMIT_PER_TYPE);

    return rows.map((g: { id: string; name: string; groupType: string }) => ({
      type: 'group' as const,
      id: g.id,
      propertyId,
      title: g.name,
      subtitle: g.groupType,
      href: `/groups/${g.id}?propertyId=${propertyId}`,
    }));
  }

  /** Resolve property name for portfolio search result subtitles. */
  async propertyNameMap(propertyIds: string[]): Promise<Map<string, string>> {
    if (!propertyIds.length) return new Map();
    const rows = await this.db
      .select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(inArray(properties.id, propertyIds));
    return new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
  }
}
