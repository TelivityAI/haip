import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  auditLogs,
  bookingRequestEmailDeliveries,
  bookingRequests,
} from './booking-request-db.js';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  actorFields,
  type AuditActor,
} from '../../common/audit/audit-actor';
import { DRIZZLE } from '../../database/database.module';
import type { EmailResult } from '../agent/guest-comms/email.service';
import { EmailService } from '../agent/guest-comms/email.service';

export type BookingRequestEmailKind =
  typeof bookingRequestEmailDeliveries.$inferInsert['kind'];

export type QueueBookingRequestEmail = {
  propertyId: string;
  bookingRequestId: string;
  logicalKey: string;
  kind: BookingRequestEmailKind;
  recipient: string;
  subject: string;
  bodyText: string;
};

export type BookingRequestEmailDeliveryView = {
  id: string;
  kind: BookingRequestEmailKind;
  status: typeof bookingRequestEmailDeliveries.$inferSelect['status'];
  subject: string;
  bodyText: string;
  errorMessage: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Delivery = typeof bookingRequestEmailDeliveries.$inferSelect;
type MailerDatabase = PostgresJsDatabase;
type QueueExecutor = Pick<MailerDatabase, 'insert' | 'select'>;
type DeliveryMode = 'automatic' | 'manual';

const CLAIM_LEASE_MS = 5 * 60 * 1000;
const SEND_TIMEOUT_MS = 60 * 1000;
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 2 * 60 * 1000;
const MAX_AUTOMATIC_ATTEMPTS = 5;

@Injectable()
export class BookingRequestMailerService {
  private readonly logger = new Logger(BookingRequestMailerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: MailerDatabase,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  async queue(
    input: QueueBookingRequestEmail,
    executor: QueueExecutor = this.db,
  ): Promise<string> {
    const logicalKey = input.logicalKey.trim();
    if (!logicalKey || logicalKey.length > 200) {
      throw new Error('A valid Booking Request email logical key is required');
    }
    const queuedAt = new Date();
    const [created] = await executor
      .insert(bookingRequestEmailDeliveries)
      .values({
        propertyId: input.propertyId,
        bookingRequestId: input.bookingRequestId,
        logicalKey,
        kind: input.kind,
        recipient: input.recipient.trim(),
        subject: input.subject,
        bodyText: input.bodyText,
        status: 'pending',
        attempts: 0,
        automaticAttempts: 0,
        nextAttemptAt: queuedAt,
      })
      .onConflictDoNothing()
      .returning({ id: bookingRequestEmailDeliveries.id });

    if (created) {
      await executor.insert(auditLogs).values({
        propertyId: input.propertyId,
        bookingRequestId: input.bookingRequestId,
        action: 'create',
        entityType: 'booking_request_email_delivery',
        entityId: created.id,
        description: `Booking request ${input.kind} email queued`,
        newValue: {
          bookingRequestId: input.bookingRequestId,
          kind: input.kind,
          status: 'pending',
        },
      });
      return created.id;
    }

    const existing = (await executor
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        eq(bookingRequestEmailDeliveries.propertyId, input.propertyId),
        eq(bookingRequestEmailDeliveries.bookingRequestId, input.bookingRequestId),
        eq(bookingRequestEmailDeliveries.logicalKey, logicalKey),
      )))
      .find((row: Delivery) =>
        row.propertyId === input.propertyId
        && row.bookingRequestId === input.bookingRequestId
        && row.logicalKey === logicalKey);
    if (!existing) throw new Error('Booking Request email could not be queued');
    return existing.id;
  }

  async listForRequest(
    bookingRequestId: string,
    propertyId: string,
  ): Promise<BookingRequestEmailDeliveryView[]> {
    await this.assertRequestScope(bookingRequestId, propertyId);
    const rows = await this.db
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        eq(bookingRequestEmailDeliveries.propertyId, propertyId),
        eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
      ))
      .orderBy(asc(bookingRequestEmailDeliveries.createdAt));
    return rows
      .filter((row: Delivery) =>
        row.propertyId === propertyId && row.bookingRequestId === bookingRequestId)
      .map((row: Delivery) => this.toView(row));
  }

  async deliver(
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<Delivery | undefined> {
    const claimed = await this.claim(deliveryId, bookingRequestId, propertyId);
    if (!claimed || claimed.status !== 'processing') return claimed;

    return this.deliverClaimed(claimed, 'automatic');
  }

  private async deliverClaimed(
    claimed: Delivery,
    mode: DeliveryMode,
    actor?: AuditActor,
  ): Promise<Delivery> {
    const transportIdentity = this.transportIdentity(claimed.id);
    const transportResult = await this.emailService.send({
      to: claimed.recipient,
      subject: claimed.subject,
      text: claimed.bodyText,
      html: this.textAsHtml(claimed.bodyText),
      idempotencyKey: transportIdentity.idempotencyKey,
      messageId: transportIdentity.messageId,
    }, { timeoutMs: SEND_TIMEOUT_MS }).catch(() => ({ sent: false } as EmailResult));

    return this.finalizeAttempt(claimed, transportResult, mode, actor);
  }

  async retry(
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
    actor: AuditActor,
  ): Promise<BookingRequestEmailDeliveryView> {
    const claimed = await this.db.transaction(async (tx) => {
      const row = await this.findDelivery(tx, deliveryId, bookingRequestId, propertyId, true);
      if (row.status !== 'failed') {
        throw new ConflictException('Only a failed email delivery can be retried');
      }
      const claimedAt = new Date();
      const leaseUntil = new Date(claimedAt.getTime() + CLAIM_LEASE_MS);
      const [manualClaim] = await tx
        .update(bookingRequestEmailDeliveries)
        .set({
          status: 'processing',
          attempts: row.attempts + 1,
          automaticAttempts: 0,
          claimedAt,
          nextAttemptAt: leaseUntil,
          lastAttemptAt: claimedAt,
          errorMessage: null,
          providerMessageId: null,
          updatedAt: claimedAt,
        })
        .where(and(
          eq(bookingRequestEmailDeliveries.id, deliveryId),
          eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
          eq(bookingRequestEmailDeliveries.propertyId, propertyId),
          eq(bookingRequestEmailDeliveries.status, 'failed'),
        ))
        .returning();
      if (!manualClaim) throw new ConflictException('Email delivery retry state changed');
      await tx.insert(auditLogs).values({
        propertyId,
        bookingRequestId,
        action: 'update',
        entityType: 'booking_request_email_delivery',
        entityId: deliveryId,
        ...actorFields(actor),
        previousValue: { status: 'failed', attempts: row.attempts },
        newValue: {
          status: 'processing',
          attempts: manualClaim.attempts,
          automaticAttempts: 0,
          mode: 'manual',
        },
        description: 'Booking request email delivery attempted',
      });
      return manualClaim;
    });

    return this.toView(await this.deliverClaimed(claimed, 'manual', actor));
  }

  async deliverForRequestBestEffort(
    bookingRequestId: string,
    propertyId: string,
  ): Promise<void> {
    try {
      const now = new Date();
      const deliveries = await this.scopedDeliveries(bookingRequestId, propertyId);
      for (const delivery of deliveries) {
        if (!this.isAutomaticallyEligible(delivery, now)) continue;
        await this.deliver(delivery.id, bookingRequestId, propertyId);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Booking request ${bookingRequestId} was committed but email delivery failed`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async processPendingDeliveries(limit = 100): Promise<number> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS);
    const rows = await this.db
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        or(
          and(
            eq(bookingRequestEmailDeliveries.status, 'pending'),
            isNull(bookingRequestEmailDeliveries.claimedAt),
            lte(bookingRequestEmailDeliveries.nextAttemptAt, now),
          ),
          and(
            eq(bookingRequestEmailDeliveries.status, 'processing'),
            lte(bookingRequestEmailDeliveries.claimedAt, staleBefore),
            lte(bookingRequestEmailDeliveries.nextAttemptAt, now),
          ),
        ),
      ))
      .orderBy(asc(bookingRequestEmailDeliveries.nextAttemptAt))
      .limit(Math.max(1, Math.min(limit, 500)));
    const candidates = rows.filter((row: Delivery) =>
      this.isRecoveryCandidate(row, now, staleBefore));
    for (const row of candidates) {
      if (row.automaticAttempts >= MAX_AUTOMATIC_ATTEMPTS) {
        await this.terminalizeExhaustedClaim(row, now, staleBefore);
      } else {
        await this.deliver(row.id, row.bookingRequestId, row.propertyId);
      }
    }
    return candidates.length;
  }

  private async claim(
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<Delivery | undefined> {
    return this.db.transaction(async (tx) => {
      const row = await this.findDelivery(tx, deliveryId, bookingRequestId, propertyId, true);
      const now = new Date();
      if (row.status === 'sent' || row.status === 'failed') return row;
      if (!this.isAutomaticallyEligible(row, now)) return undefined;

      const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
      const [claimed] = await tx
        .update(bookingRequestEmailDeliveries)
        .set({
          status: 'processing',
          attempts: row.attempts + 1,
          automaticAttempts: row.automaticAttempts + 1,
          claimedAt: now,
          nextAttemptAt: leaseUntil,
          lastAttemptAt: now,
          errorMessage: null,
          updatedAt: now,
        })
        .where(and(
          eq(bookingRequestEmailDeliveries.id, deliveryId),
          eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
          eq(bookingRequestEmailDeliveries.propertyId, propertyId),
          eq(bookingRequestEmailDeliveries.status, row.status),
          row.claimedAt
            ? eq(bookingRequestEmailDeliveries.claimedAt, row.claimedAt)
            : isNull(bookingRequestEmailDeliveries.claimedAt),
        ))
        .returning();
      if (!claimed) return undefined;
      await tx.insert(auditLogs).values({
        propertyId,
        bookingRequestId,
        action: 'update',
        entityType: 'booking_request_email_delivery',
        entityId: deliveryId,
        ...actorFields(),
        previousValue: { status: row.status, attempts: row.attempts },
        newValue: {
          status: 'processing',
          attempts: claimed.attempts,
          automaticAttempts: claimed.automaticAttempts,
        },
        description: 'Booking request email delivery attempted',
      });
      return claimed;
    });
  }

  private async finalizeAttempt(
    claimed: Delivery,
    transportResult: EmailResult,
    mode: DeliveryMode,
    actor?: AuditActor,
  ): Promise<Delivery> {
    const finishedAt = new Date();
    const shouldRetry = !transportResult.sent
      && !transportResult.outcomeUnknown
      && mode === 'automatic'
      && claimed.automaticAttempts < MAX_AUTOMATIC_ATTEMPTS;
    const status: Delivery['status'] = transportResult.sent
      ? 'sent'
      : shouldRetry ? 'pending' : 'failed';
    const nextAttemptAt = shouldRetry
      ? new Date(finishedAt.getTime() + this.backoffMs(claimed.automaticAttempts))
      : null;
    const errorMessage = transportResult.sent
      ? null
      : transportResult.outcomeUnknown
        ? 'Email delivery outcome requires manual review'
        : 'Email transport failed';

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(bookingRequestEmailDeliveries)
        .set({
          status,
          claimedAt: null,
          nextAttemptAt,
          errorMessage,
          providerMessageId: transportResult.messageId ?? null,
          sentAt: transportResult.sent ? finishedAt : null,
          updatedAt: finishedAt,
        })
        .where(and(
          eq(bookingRequestEmailDeliveries.id, claimed.id),
          eq(bookingRequestEmailDeliveries.propertyId, claimed.propertyId),
          eq(bookingRequestEmailDeliveries.bookingRequestId, claimed.bookingRequestId),
          eq(bookingRequestEmailDeliveries.status, 'processing'),
          eq(bookingRequestEmailDeliveries.claimedAt, claimed.claimedAt!),
        ))
        .returning();
      if (!updated) {
        return this.findDelivery(
          tx,
          claimed.id,
          claimed.bookingRequestId,
          claimed.propertyId,
          false,
        );
      }
      await tx.insert(auditLogs).values({
        propertyId: updated.propertyId,
        bookingRequestId: updated.bookingRequestId,
        action: 'update',
        entityType: 'booking_request_email_delivery',
        entityId: updated.id,
        ...actorFields(actor),
        previousValue: { status: 'processing' },
        newValue: {
          kind: updated.kind,
          status: updated.status,
          attempts: updated.attempts,
          automaticAttempts: updated.automaticAttempts,
          ...(updated.errorMessage ? { error: updated.errorMessage } : {}),
        },
        description: updated.status === 'sent'
          ? 'Booking request email delivered'
          : updated.status === 'pending'
            ? 'Booking request email delivery scheduled for retry'
            : 'Booking request email delivery failed terminally',
      });
      return updated;
    });
  }

  private isAutomaticallyEligible(
    delivery: Delivery,
    now: Date,
    staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS),
  ): boolean {
    if (delivery.automaticAttempts >= MAX_AUTOMATIC_ATTEMPTS) return false;
    return this.isRecoveryCandidate(delivery, now, staleBefore);
  }

  private isRecoveryCandidate(
    delivery: Delivery,
    now: Date,
    staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS),
  ): boolean {
    if (delivery.status === 'pending') {
      return !delivery.claimedAt
        && Boolean(delivery.nextAttemptAt)
        && delivery.nextAttemptAt!.getTime() <= now.getTime();
    }
    return delivery.status === 'processing'
      && Boolean(delivery.claimedAt)
      && delivery.claimedAt!.getTime() <= staleBefore.getTime()
      && Boolean(delivery.nextAttemptAt)
      && delivery.nextAttemptAt!.getTime() <= now.getTime();
  }

  private async terminalizeExhaustedClaim(
    candidate: Delivery,
    now: Date,
    staleBefore: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const current = await this.findDelivery(
        tx,
        candidate.id,
        candidate.bookingRequestId,
        candidate.propertyId,
        true,
      );
      if (
        current.automaticAttempts < MAX_AUTOMATIC_ATTEMPTS
        || !this.isRecoveryCandidate(current, now, staleBefore)
      ) {
        return false;
      }
      const [updated] = await tx
        .update(bookingRequestEmailDeliveries)
        .set({
          status: 'failed',
          claimedAt: null,
          nextAttemptAt: null,
          errorMessage: 'Email transport failed',
          updatedAt: now,
        })
        .where(and(
          eq(bookingRequestEmailDeliveries.id, current.id),
          eq(bookingRequestEmailDeliveries.propertyId, current.propertyId),
          eq(bookingRequestEmailDeliveries.bookingRequestId, current.bookingRequestId),
          eq(bookingRequestEmailDeliveries.status, current.status),
          eq(bookingRequestEmailDeliveries.automaticAttempts, current.automaticAttempts),
          current.claimedAt
            ? eq(bookingRequestEmailDeliveries.claimedAt, current.claimedAt)
            : isNull(bookingRequestEmailDeliveries.claimedAt),
        ))
        .returning();
      if (!updated) return false;
      await tx.insert(auditLogs).values({
        propertyId: updated.propertyId,
        bookingRequestId: updated.bookingRequestId,
        action: 'update',
        entityType: 'booking_request_email_delivery',
        entityId: updated.id,
        previousValue: { status: current.status },
        newValue: {
          kind: updated.kind,
          status: updated.status,
          attempts: updated.attempts,
          automaticAttempts: updated.automaticAttempts,
          error: updated.errorMessage,
        },
        description: 'Booking request email delivery failed terminally',
      });
      return true;
    });
  }

  private backoffMs(automaticAttempts: number): number {
    return Math.min(RETRY_BASE_MS * (2 ** Math.max(0, automaticAttempts - 1)), RETRY_MAX_MS);
  }

  /**
   * SMTP and providers without server-side idempotency remain at-least-once
   * across a crash after transport acceptance. Reusing this identity on every
   * replay gives supporting gateways a dedupe key and all transports the same
   * RFC Message-ID (or, for SES, its permitted stable custom-header equivalent).
   */
  private transportIdentity(deliveryId: string): {
    idempotencyKey: string;
    messageId: string;
  } {
    return {
      idempotencyKey: `booking-request-email:${deliveryId}`,
      messageId: `<booking-request-email-${deliveryId}@haip.local>`,
    };
  }

  private async scopedDeliveries(
    bookingRequestId: string,
    propertyId: string,
  ): Promise<Delivery[]> {
    await this.assertRequestScope(bookingRequestId, propertyId);
    const rows = await this.db
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        eq(bookingRequestEmailDeliveries.propertyId, propertyId),
        eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
      ));
    return rows.filter((row: Delivery) =>
      row.propertyId === propertyId && row.bookingRequestId === bookingRequestId);
  }

  private async assertRequestScope(bookingRequestId: string, propertyId: string): Promise<void> {
    const rows = await this.db
      .select({ id: bookingRequests.id, propertyId: bookingRequests.propertyId })
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.id, bookingRequestId),
        eq(bookingRequests.propertyId, propertyId),
      ));
    if (!rows.some((row: { id: string; propertyId: string }) =>
      row.id === bookingRequestId && row.propertyId === propertyId)) {
      throw new NotFoundException(`Booking request ${bookingRequestId} not found`);
    }
  }

  private async findDelivery(
    executor: Pick<MailerDatabase, 'select'>,
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
    lock: boolean,
  ): Promise<Delivery> {
    const query = executor
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        eq(bookingRequestEmailDeliveries.id, deliveryId),
        eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
        eq(bookingRequestEmailDeliveries.propertyId, propertyId),
      ));
    const rows = lock ? await query.for('update') : await query;
    const row = rows.find((candidate: Delivery) =>
      candidate.id === deliveryId
      && candidate.bookingRequestId === bookingRequestId
      && candidate.propertyId === propertyId);
    if (!row) throw new NotFoundException(`Email delivery ${deliveryId} not found`);
    return row;
  }

  private toView(delivery: Delivery): BookingRequestEmailDeliveryView {
    return {
      id: delivery.id,
      kind: delivery.kind,
      status: delivery.status,
      subject: delivery.subject,
      bodyText: delivery.bodyText,
      errorMessage: delivery.errorMessage,
      attempts: delivery.attempts,
      nextAttemptAt: delivery.nextAttemptAt,
      lastAttemptAt: delivery.lastAttemptAt,
      sentAt: delivery.sentAt,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
    };
  }

  private textAsHtml(text: string): string {
    return `<p>${text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
      .replaceAll('\n', '<br>')}</p>`;
  }
}
