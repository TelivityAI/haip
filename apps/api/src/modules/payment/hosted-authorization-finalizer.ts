import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { auditLogs, depositLedgerEntries, folios, payments, reservations } from '@telivityhaip/database';
import { assertTransition } from '../reservation/reservation-state-machine';
import type { WebhookPayload } from '../webhook/webhook.service';

/**
 * Promote a pending hosted-checkout hold after the provider confirms it.
 * Competing callbacks observe a terminal status and do not repeat the deposit.
 */
export async function finalizeHostedAuthorization(
  db: any,
  input: {
    paymentId: string;
    propertyId: string;
    gatewayProvider: string;
    success: boolean;
    failureReason: string;
    gatewayTransactionId?: string;
  },
): Promise<WebhookPayload[]> {
  const { paymentId, propertyId, gatewayProvider, success, failureReason } = input;
  return db.transaction(async (tx: any) => {
    const [payment] = await tx
      .update(payments)
      .set({
        status: success ? 'authorized' : 'failed',
        updatedAt: new Date(),
        ...(input.gatewayTransactionId ? { gatewayTransactionId: input.gatewayTransactionId } : {}),
      })
      .where(and(
        eq(payments.id, paymentId),
        eq(payments.propertyId, propertyId),
        eq(payments.gatewayProvider, gatewayProvider),
        eq(payments.status, 'pending'),
      ))
      .returning();
    if (!payment) return [];

    const pendingEvents: WebhookPayload[] = [];
    const addEvent = (event: WebhookPayload['event'], entityType: string, entityId: string, data: Record<string, unknown>) => {
      pendingEvents.push({
        event, entityType, entityId, propertyId, data,
        timestamp: new Date().toISOString(), logicalEventId: randomUUID(),
      });
    };
    addEvent(success ? 'payment.received' : 'payment.failed', 'payment', payment.id,
      success
        ? { folioId: payment.folioId, status: 'authorized', amount: payment.amount, gatewayProvider }
        : { folioId: payment.folioId, error: failureReason });

    const intent = payment.authorizationFinalization?.deposit;
    if (success && intent) {
      const [folio] = await tx.select().from(folios).where(and(eq(folios.id, payment.folioId), eq(folios.propertyId, propertyId)));
      if (!folio || folio.reservationId !== intent.reservationId) {
        throw new BadRequestException('Deposit reservation must match the payment folio');
      }
      const [reservation] = await tx.select().from(reservations)
        .where(and(eq(reservations.id, intent.reservationId), eq(reservations.propertyId, propertyId)))
        .for('update');
      if (!reservation) throw new BadRequestException('Deposit reservation not found in this property');

      const [deposit] = await tx.insert(depositLedgerEntries).values({
        propertyId, reservationId: reservation.id, paymentId: payment.id,
        amount: new Decimal(payment.amount).toFixed(2), currencyCode: payment.currencyCode,
        status: 'held', isRefundable: intent.isRefundable,
      }).returning();
      addEvent('deposit.received', 'deposit', deposit.id, {
        amount: deposit.amount, status: deposit.status, isRefundable: deposit.isRefundable,
      });

      if (intent.autoConfirm && reservation.status === 'pending') {
        assertTransition(reservation.status, 'confirmed');
        await tx.update(reservations).set({ status: 'confirmed', updatedAt: new Date() })
          .where(and(eq(reservations.id, reservation.id), eq(reservations.propertyId, propertyId), eq(reservations.status, 'pending')));
        addEvent('reservation.confirmed', 'reservation', reservation.id, { status: 'confirmed' });
      }
    }

    for (const payload of pendingEvents) {
      await tx.insert(auditLogs).values({
        id: payload.logicalEventId, propertyId, action: 'create',
        entityType: payload.entityType, entityId: payload.entityId,
        description: `Webhook event: ${payload.event}`, newValue: payload,
      });
    }
    return pendingEvents;
  });
}
