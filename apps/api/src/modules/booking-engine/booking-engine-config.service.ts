import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { bookingEngineConfig, bookingEngineCredentials } from '@telivityhaip/database';
import type {
  BookingFormQuestion,
  BookingMode,
  DepositPolicy,
  PaymentMethodCollection,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { hashBookingKey } from '../auth/booking-key.guard';
import { validateQuestionDefinitions } from './booking-form-questions';

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
  bookingMode?: BookingMode;
  paymentMethodCollection?: PaymentMethodCollection;
  formQuestions?: BookingFormQuestion[];
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
    const formQuestions = validateQuestionDefinitions(
      (cfg.formQuestions ?? []) as BookingFormQuestion[],
    )
      .filter((question) => question.isActive)
      .sort((a, b) => a.order - b.order);
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
      bookingMode: cfg.bookingMode as BookingMode,
      paymentMethodCollection: cfg.paymentMethodCollection as PaymentMethodCollection,
      formQuestions,
    };
  }

  async updateConfig(propertyId: string, input: UpdateConfigInput) {
    await this.getConfig(propertyId); // ensure a row exists before locking it

    return this.db.transaction(async (tx: any) => {
      const [current] = await tx
        .select()
        .from(bookingEngineConfig)
        .where(eq(bookingEngineConfig.propertyId, propertyId))
        .for('update');
      if (!current) {
        throw new NotFoundException(`Booking engine config for property ${propertyId} not found`);
      }

      const bookingMode = input.bookingMode ?? current.bookingMode as BookingMode;
      const paymentMethodCollection = input.paymentMethodCollection
        ?? current.paymentMethodCollection as PaymentMethodCollection;
      const stripePublishableKey = input.stripePublishableKey === undefined
        ? current.stripePublishableKey
        : input.stripePublishableKey;
      const formQuestions = input.formQuestions === undefined
        ? undefined
        : validateQuestionDefinitions(input.formQuestions);

      if (bookingMode === 'request'
        && paymentMethodCollection === 'required'
        && (!stripePublishableKey || stripePublishableKey.trim().length === 0)) {
        throw new BadRequestException(
          'A Stripe publishable key is required when request-mode card collection is required',
        );
      }

      const [updated] = await tx
        .update(bookingEngineConfig)
        .set({
          ...Object.fromEntries(
            Object.entries(input).filter(([, value]) => value !== undefined),
          ),
          ...(input.formQuestions === undefined ? {} : { formQuestions }),
          updatedAt: new Date(),
        })
        .where(eq(bookingEngineConfig.propertyId, propertyId))
        .returning();
      return updated;
    });
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
