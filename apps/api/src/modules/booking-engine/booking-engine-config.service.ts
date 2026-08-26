import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { auditLogs, bookingEngineConfig, bookingEngineCredentials } from '@telivityhaip/database';
import type {
  BookingFormQuestionDefinition,
  BookingMode,
  DepositPolicy,
  PaymentMethodCollection,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { hashBookingKey } from '../auth/booking-key.guard';
import { resolvePaymentGatewayProvider } from '../payment/payment-gateway.factory';
import { isSupportedQuestion, validateQuestionDefinitions } from './booking-form-questions';

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
  formQuestions?: BookingFormQuestionDefinition[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sanitizeBookingFormDefinition(value: unknown): Record<string, unknown> {
  const question = asRecord(value);
  const options = question['options'];
  return {
    ...(typeof question['id'] === 'string' ? { id: question['id'] } : {}),
    ...(typeof question['label'] === 'string' ? { label: question['label'] } : {}),
    ...(typeof question['type'] === 'string' ? { type: question['type'] } : {}),
    ...(Array.isArray(options) && options.every((option) => typeof option === 'string')
      ? { options: [...options] }
      : {}),
    ...(typeof question['order'] === 'number' && Number.isFinite(question['order'])
      ? { order: question['order'] }
      : {}),
    ...(typeof question['isActive'] === 'boolean' ? { isActive: question['isActive'] } : {}),
    ...(typeof question['isRequired'] === 'boolean' ? { isRequired: question['isRequired'] } : {}),
  };
}

function sanitizeDepositPolicy(value: unknown): Record<string, unknown> {
  const policy = asRecord(value);
  return {
    ...(typeof policy['type'] === 'string' ? { type: policy['type'] } : {}),
    ...(typeof policy['percentage'] === 'number' && Number.isFinite(policy['percentage'])
      ? { percentage: policy['percentage'] }
      : {}),
    ...(typeof policy['refundable'] === 'boolean' ? { refundable: policy['refundable'] } : {}),
  };
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([key, nestedValue]) => [key, normalizeJsonValue(nestedValue)]),
  );
}

/**
 * Keep the settings operators need to reconstruct a configuration change while
 * explicitly excluding credential-bearing fields from the immutable audit trail.
 */
export function sanitizeBookingEngineConfig(
  config: typeof bookingEngineConfig.$inferSelect,
): Record<string, unknown> {
  return {
    isEnabled: config.isEnabled,
    displayName: config.displayName,
    logoMediaId: config.logoMediaId,
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    sellableRoomTypeIds: sanitizeStringArray(config.sellableRoomTypeIds),
    sellableRatePlanIds: sanitizeStringArray(config.sellableRatePlanIds),
    depositPolicy: sanitizeDepositPolicy(config.depositPolicy),
    autoConfirm: config.autoConfirm,
    bookingMode: config.bookingMode,
    paymentMethodCollection: config.paymentMethodCollection,
    formQuestions: config.formQuestions.map(sanitizeBookingFormDefinition),
  };
}

@Injectable()
export class BookingEngineConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly runtimeConfig: ConfigService,
  ) {}

  private paymentMethodClientMode(): 'mock' | 'stripe' | 'unsupported' {
    const provider = resolvePaymentGatewayProvider(this.runtimeConfig);
    if (provider === 'mock' || provider === 'stripe') return provider;
    return 'unsupported';
  }

  /** Full config row (admin view). Creates a default row on first access. */
  async getConfig(propertyId: string, db?: any, lockForUpdate = false) {
    const conn = db ?? this.db;
    const query = conn
      .select()
      .from(bookingEngineConfig)
      .where(eq(bookingEngineConfig.propertyId, propertyId));
    const [existing] = lockForUpdate ? await query.for('update') : await query;
    if (existing) return existing;

    const [created] = await conn
      .insert(bookingEngineConfig)
      .values({ propertyId })
      .returning();
    return created;
  }

  /**
   * Public-safe config for the widget. Excludes nothing secret (Stripe key here is
   * the PUBLISHABLE key only). Returned for the property bound to the booking key.
   */
  async getPublicConfig(propertyId: string, db?: any, lockForUpdate = false) {
    const cfg = await this.getConfig(propertyId, db, lockForUpdate);
    const bookingMode = cfg.bookingMode as BookingMode;
    const configuredPaymentMethodCollection =
      cfg.paymentMethodCollection as PaymentMethodCollection;
    const paymentMethodClientMode = this.paymentMethodClientMode();
    const formQuestions = validateQuestionDefinitions(
      cfg.formQuestions ?? [],
      { allowActiveUnsupported: true },
    )
      .filter(isSupportedQuestion)
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
      bookingMode,
      paymentMethodCollection: configuredPaymentMethodCollection,
      paymentMethodClientMode,
      formQuestions,
    };
  }

  async getAdminConfig(propertyId: string) {
    const cfg = await this.getConfig(propertyId);
    return {
      ...cfg,
      paymentMethodClientMode: this.paymentMethodClientMode(),
    };
  }

  async updateConfig(
    propertyId: string,
    input: UpdateConfigInput,
    expectedVersion: string | undefined,
    actor: AuditActor,
  ) {
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

      const patch = input;
      const currentUpdatedAt = new Date(current.updatedAt);
      const expectedUpdatedAt = expectedVersion === undefined ? undefined : new Date(expectedVersion);
      // If-Match is optional for one rolling-deployment window so legacy
      // dashboards can still save. Such requests intentionally have reduced
      // lost-update protection until all clients send the header.
      if (expectedUpdatedAt !== undefined && (
        Number.isNaN(expectedUpdatedAt.valueOf())
        || expectedUpdatedAt.valueOf() !== currentUpdatedAt.valueOf()
      )) {
        throw new ConflictException(
          'Booking engine settings changed since they were loaded',
        );
      }

      const bookingMode = patch.bookingMode ?? current.bookingMode as BookingMode;
      const paymentMethodCollection = patch.paymentMethodCollection
        ?? current.paymentMethodCollection as PaymentMethodCollection;
      const stripePublishableKey = patch.stripePublishableKey === undefined
        ? current.stripePublishableKey
        : patch.stripePublishableKey;
      const formQuestions = patch.formQuestions === undefined
        ? undefined
        : validateQuestionDefinitions(patch.formQuestions);
      const requestedPatch = {
        ...Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined),
        ),
        ...(formQuestions === undefined ? {} : { formQuestions }),
      };
      const normalizedPatch = Object.fromEntries(
        Object.entries(requestedPatch).map(([field, value]) => [field, normalizeJsonValue(value)]),
      );

      if (Object.entries(normalizedPatch).every(([field, value]) =>
        isDeepStrictEqual(normalizeJsonValue(current[field]), value))) {
        return current;
      }

      const paymentMethodClientMode = this.paymentMethodClientMode();

      if (bookingMode === 'request'
        && paymentMethodCollection !== 'disabled'
        && paymentMethodClientMode === 'unsupported') {
        throw new BadRequestException(
          'Saved card collection is not supported by the configured payment provider',
        );
      }

      if (bookingMode === 'request'
        && paymentMethodCollection !== 'disabled'
        && paymentMethodClientMode === 'stripe'
        && (!stripePublishableKey || stripePublishableKey.trim().length === 0)) {
        throw new BadRequestException(
          'A Stripe publishable key is required when request-mode card collection is enabled',
        );
      }

      const now = new Date();
      const nextUpdatedAt = now.valueOf() > currentUpdatedAt.valueOf()
        ? now
        : new Date(currentUpdatedAt.valueOf() + 1);
      const [updated] = await tx
        .update(bookingEngineConfig)
        .set({
          ...normalizedPatch,
          updatedAt: nextUpdatedAt,
        })
        .where(eq(bookingEngineConfig.propertyId, propertyId))
        .returning();
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'booking_engine_config',
        entityId: updated.id,
        ...actorFields(actor),
        previousValue: sanitizeBookingEngineConfig(current),
        newValue: sanitizeBookingEngineConfig(updated),
        description: 'Booking engine configuration updated',
      });
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
