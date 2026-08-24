import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  auditLogs,
  bookingRequestEmailDeliveries,
  bookingRequests,
} from '@telivityhaip/database';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
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

type Delivery = typeof bookingRequestEmailDeliveries.$inferSelect;
type MailerDatabase = PostgresJsDatabase;
type QueueExecutor = Pick<MailerDatabase, 'insert' | 'select'>;

const CLAIM_LEASE_MS = 5 * 60 * 1000;

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
      })
      .onConflictDoNothing()
      .returning({ id: bookingRequestEmailDeliveries.id });

    if (created) {
      await executor.insert(auditLogs).values({
        propertyId: input.propertyId,
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

  async listForRequest(bookingRequestId: string, propertyId: string): Promise<Delivery[]> {
    await this.assertRequestScope(bookingRequestId, propertyId);
    const rows = await this.db
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        eq(bookingRequestEmailDeliveries.propertyId, propertyId),
        eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
      ))
      .orderBy(asc(bookingRequestEmailDeliveries.createdAt));
    return rows.filter((row: Delivery) =>
      row.propertyId === propertyId && row.bookingRequestId === bookingRequestId);
  }

  async deliver(
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<Delivery | undefined> {
    const claimed = await this.claim(deliveryId, bookingRequestId, propertyId);
    if (!claimed || claimed.status === 'sent') return claimed;

    let sent: boolean;
    try {
      const result = await this.emailService.send({
        to: claimed.recipient,
        subject: claimed.subject,
        text: claimed.bodyText,
        html: this.textAsHtml(claimed.bodyText),
      });
      sent = result.sent;
    } catch {
      sent = false;
    }

    const finishedAt = new Date();
    const errorMessage = sent ? null : 'Email transport failed';
    const [updated] = await this.db
      .update(bookingRequestEmailDeliveries)
      .set({
        status: sent ? 'sent' : 'failed',
        claimedAt: null,
        errorMessage,
        sentAt: sent ? finishedAt : null,
        updatedAt: finishedAt,
      })
      .where(and(
        eq(bookingRequestEmailDeliveries.id, claimed.id),
        eq(bookingRequestEmailDeliveries.propertyId, propertyId),
        eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
        eq(bookingRequestEmailDeliveries.claimedAt, claimed.claimedAt!),
      ))
      .returning();
    const result = updated ?? { ...claimed, status: sent ? 'sent' : 'failed', errorMessage };
    await this.auditAttemptBestEffort(result);
    return result;
  }

  async retry(
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<Delivery | undefined> {
    await this.findDelivery(deliveryId, bookingRequestId, propertyId);
    return this.deliver(deliveryId, bookingRequestId, propertyId);
  }

  async deliverForRequestBestEffort(
    bookingRequestId: string,
    propertyId: string,
  ): Promise<void> {
    try {
      const deliveries = await this.listForRequest(bookingRequestId, propertyId);
      for (const delivery of deliveries) {
        if (delivery.status === 'sent') continue;
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
    const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS);
    const rows = await this.db
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        or(
          eq(bookingRequestEmailDeliveries.status, 'pending'),
          eq(bookingRequestEmailDeliveries.status, 'failed'),
        ),
        or(
          isNull(bookingRequestEmailDeliveries.claimedAt),
          lte(bookingRequestEmailDeliveries.claimedAt, staleBefore),
        ),
      ))
      .orderBy(asc(bookingRequestEmailDeliveries.createdAt))
      .limit(Math.max(1, Math.min(limit, 500)));
    const recoverable = rows.filter((row: Delivery) =>
      row.status !== 'sent'
      && (!row.claimedAt || row.claimedAt.getTime() <= staleBefore.getTime()));
    for (const row of recoverable) {
      await this.deliver(row.id, row.bookingRequestId, row.propertyId);
    }
    return recoverable.length;
  }

  private async claim(
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<Delivery | undefined> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bookingRequestEmailDeliveries)
        .where(and(
          eq(bookingRequestEmailDeliveries.id, deliveryId),
          eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
          eq(bookingRequestEmailDeliveries.propertyId, propertyId),
        ))
        .for('update');
      const row = rows.find((candidate: Delivery) =>
        candidate.id === deliveryId
        && candidate.bookingRequestId === bookingRequestId
        && candidate.propertyId === propertyId);
      if (!row) throw new NotFoundException(`Email delivery ${deliveryId} not found`);
      if (row.status === 'sent') return row;
      if (row.claimedAt && row.claimedAt.getTime() > Date.now() - CLAIM_LEASE_MS) {
        return undefined;
      }
      const attemptedAt = new Date();
      const [claimed] = await tx
        .update(bookingRequestEmailDeliveries)
        .set({
          status: 'pending',
          attempts: row.attempts + 1,
          claimedAt: attemptedAt,
          lastAttemptAt: attemptedAt,
          errorMessage: null,
          updatedAt: attemptedAt,
        })
        .where(and(
          eq(bookingRequestEmailDeliveries.id, deliveryId),
          eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
          eq(bookingRequestEmailDeliveries.propertyId, propertyId),
        ))
        .returning();
      return claimed;
    });
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
    deliveryId: string,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<Delivery> {
    const rows = await this.db
      .select()
      .from(bookingRequestEmailDeliveries)
      .where(and(
        eq(bookingRequestEmailDeliveries.id, deliveryId),
        eq(bookingRequestEmailDeliveries.bookingRequestId, bookingRequestId),
        eq(bookingRequestEmailDeliveries.propertyId, propertyId),
      ));
    const row = rows.find((candidate: Delivery) =>
      candidate.id === deliveryId
      && candidate.bookingRequestId === bookingRequestId
      && candidate.propertyId === propertyId);
    if (!row) throw new NotFoundException(`Email delivery ${deliveryId} not found`);
    return row;
  }

  private async auditAttemptBestEffort(delivery: Delivery): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        propertyId: delivery.propertyId,
        action: 'update',
        entityType: 'booking_request_email_delivery',
        entityId: delivery.id,
        description: delivery.status === 'sent'
          ? 'Booking request email delivered'
          : 'Booking request email delivery failed',
        newValue: {
          bookingRequestId: delivery.bookingRequestId,
          kind: delivery.kind,
          status: delivery.status,
          attempts: delivery.attempts,
          ...(delivery.errorMessage ? { error: delivery.errorMessage } : {}),
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Email delivery ${delivery.id} state changed but its audit write failed`,
        error instanceof Error ? error.stack : undefined,
      );
    }
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
