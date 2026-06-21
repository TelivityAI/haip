import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { bookingEngineConfig, bookingEngineCredentials } from '@telivityhaip/database';
import type { DepositPolicy } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { hashBookingKey } from '../auth/booking-key.guard';

// Crockford base32 (no I/L/O/U) — unambiguous when copied by a human.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomToken(bytes: number): string {
  const buf = randomBytes(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += CROCKFORD[buf[i]! & 0x1f];
    out += CROCKFORD[(buf[i]! >> 5) & 0x1f];
  }
  return out;
}

export interface UpdateConfigInput {
  isEnabled?: boolean;
  displayName?: string | null;
  logoMediaId?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  sellableRoomTypeIds?: string[];
  sellableRatePlanIds?: string[];
  depositPolicy?: DepositPolicy;
  autoConfirm?: boolean;
  stripePublishableKey?: string | null;
}

@Injectable()
export class BookingEngineConfigService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /** Full config row (admin view). Creates a default row on first access. */
  async getConfig(propertyId: string) {
    const [existing] = await this.db
      .select()
      .from(bookingEngineConfig)
      .where(eq(bookingEngineConfig.propertyId, propertyId));
    if (existing) return existing;

    const [created] = await this.db
      .insert(bookingEngineConfig)
      .values({ propertyId })
      .returning();
    return created;
  }

  /**
   * Public-safe config for the widget. Excludes nothing secret (Stripe key here is
   * the PUBLISHABLE key only). Returned for the property bound to the booking key.
   */
  async getPublicConfig(propertyId: string) {
    const cfg = await this.getConfig(propertyId);
    return {
      propertyId: cfg.propertyId,
      isEnabled: cfg.isEnabled,
      displayName: cfg.displayName,
      logoMediaId: cfg.logoMediaId,
      primaryColor: cfg.primaryColor,
      accentColor: cfg.accentColor,
      depositPolicy: cfg.depositPolicy as DepositPolicy,
      stripePublishableKey: cfg.stripePublishableKey,
      sellableRoomTypeIds: cfg.sellableRoomTypeIds as string[],
      sellableRatePlanIds: cfg.sellableRatePlanIds as string[],
    };
  }

  async updateConfig(propertyId: string, input: UpdateConfigInput) {
    await this.getConfig(propertyId); // ensure row exists
    const [updated] = await this.db
      .update(bookingEngineConfig)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(bookingEngineConfig.propertyId, propertyId))
      .returning();
    return updated;
  }

  // --- Publishable keys ---

  async listKeys(propertyId: string) {
    const rows = await this.db
      .select({
        id: bookingEngineCredentials.id,
        label: bookingEngineCredentials.label,
        keyPrefix: bookingEngineCredentials.keyPrefix,
        isActive: bookingEngineCredentials.isActive,
        lastUsedAt: bookingEngineCredentials.lastUsedAt,
        createdAt: bookingEngineCredentials.createdAt,
        revokedAt: bookingEngineCredentials.revokedAt,
      })
      .from(bookingEngineCredentials)
      .where(eq(bookingEngineCredentials.propertyId, propertyId))
      .orderBy(desc(bookingEngineCredentials.createdAt));
    return rows;
  }

  /**
   * Generate a new publishable key. The raw key is returned ONCE — only its
   * sha256 hash is stored. Format: `pk_live_<token>`.
   */
  async createKey(propertyId: string, label: string) {
    const rawKey = `pk_live_${randomToken(20)}`;
    const keyHash = hashBookingKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12); // "pk_live_XXXX" — non-secret display hint
    const [row] = await this.db
      .insert(bookingEngineCredentials)
      .values({ propertyId, label, keyHash, keyPrefix })
      .returning({
        id: bookingEngineCredentials.id,
        label: bookingEngineCredentials.label,
        keyPrefix: bookingEngineCredentials.keyPrefix,
        createdAt: bookingEngineCredentials.createdAt,
      });
    // rawKey shown to the operator exactly once.
    return { ...row, key: rawKey };
  }

  async revokeKey(propertyId: string, id: string) {
    const [row] = await this.db
      .update(bookingEngineCredentials)
      .set({ isActive: false, revokedAt: new Date() })
      .where(
        and(
          eq(bookingEngineCredentials.id, id),
          eq(bookingEngineCredentials.propertyId, propertyId),
        ),
      )
      .returning({ id: bookingEngineCredentials.id });
    if (!row) {
      throw new NotFoundException(`Booking key ${id} not found`);
    }
    return { revoked: true, id: row.id };
  }
}
