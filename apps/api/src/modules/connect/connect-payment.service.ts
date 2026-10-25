import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, lt } from 'drizzle-orm';
import Decimal from 'decimal.js';
import Stripe from 'stripe';
import {
  connectPaymentSessions,
  bookings,
  reservations,
  bookingEngineConfig,
  depositLedgerEntries,
  type ConnectPaymentMode,
  type DepositPolicy,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import {
  resolvePaymentGatewayProvider,
} from '../payment/payment-gateway.factory';
import { PAYMENT_GATEWAY } from '../payment/interfaces/payment-gateway.interface';
import type { PaymentGateway } from '../payment/interfaces/payment-gateway.interface';
import {
  computeDepositDue,
  resolvePaymentMode,
} from './connect-payment.helpers';

export { computeDepositDue, hashBookRequest, resolvePaymentMode } from './connect-payment.helpers';

const SESSION_TTL_MS = 45 * 60 * 1000;

@Injectable()
export class ConnectPaymentService {
  private readonly logger = new Logger(ConnectPaymentService.name);
  private readonly stripe: Stripe | null;

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly configService: ConfigService,
    private readonly folioService: FolioService,
    private readonly webhookService: WebhookService,
    @Optional() @Inject(PAYMENT_GATEWAY) private readonly gateway?: PaymentGateway,
  ) {
    const mode = this.configService.get<string>('STRIPE_MODE', 'mock');
    const key = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.stripe = mode !== 'mock' && key
      ? new Stripe(key, { apiVersion: '2025-03-31.basil', typescript: true })
      : null;
  }

  async getDepositPolicy(propertyId: string): Promise<DepositPolicy> {
    const [row] = await this.db
      .select({ depositPolicy: bookingEngineConfig.depositPolicy })
      .from(bookingEngineConfig)
      .where(eq(bookingEngineConfig.propertyId, propertyId));
    return (row?.depositPolicy as DepositPolicy) ?? { type: 'first_night', refundable: true };
  }

  async findByIdempotency(propertyId: string, idempotencyKey: string) {
    const [session] = await this.db
      .select()
      .from(connectPaymentSessions)
      .where(
        and(
          eq(connectPaymentSessions.propertyId, propertyId),
          eq(connectPaymentSessions.idempotencyKey, idempotencyKey),
        ),
      );
    return session ?? null;
  }

  /**
   * Create a hosted PSP session for a pending Connect reservation.
   * Idempotent on (propertyId, idempotencyKey).
   */
  async createHostedSession(input: {
    propertyId: string;
    confirmationNumber: string;
    reservationId: string;
    bookingId: string;
    guestId: string;
    currencyCode: string;
    grandTotal: Decimal;
    nights: number;
    idempotencyKey: string;
    requestHash: string;
    clientPlatform?: string;
    guestEmail: string;
  }) {
    const existing = await this.findByIdempotency(input.propertyId, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new ConflictException('Idempotency-Key reused with a different booking payload');
      }
      if (existing.status === 'pending' && existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
        await this.expireSession(existing.confirmationNumber);
      } else {
        return this.toPublicSession(existing);
      }
      const refreshed = await this.findByIdempotency(input.propertyId, input.idempotencyKey);
      if (refreshed && refreshed.status === 'pending') {
        return this.toPublicSession(refreshed);
      }
    }

    const policy = await this.getDepositPolicy(input.propertyId);
    const paymentMode = resolvePaymentMode(policy);
    const depositDue = computeDepositDue(policy, input.grandTotal, input.nights);
    const provider = resolvePaymentGatewayProvider(this.configService);
    const hostedProviders = new Set(['mock', 'stripe', 'redsys', 'worldline']);
    if (!hostedProviders.has(provider)) {
      throw new BadRequestException(
        `AI booking requires a hosted PSP (stripe, redsys, or worldline). Current gateway: ${provider}`,
      );
    }

    const folio = await this.folioService.createAutoFolio({
      id: input.reservationId,
      propertyId: input.propertyId,
      bookingId: input.bookingId,
      guestId: input.guestId,
      currencyCode: input.currencyCode,
    });

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const publicBase = (this.configService.get<string>('PUBLIC_API_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');

    let pspSessionId: string;
    let paymentUrl: string;

    if (provider === 'mock' || !this.stripe) {
      pspSessionId = `mock_cs_${input.confirmationNumber}`;
      paymentUrl = `${publicBase}/api/v1/connect/bookings/${encodeURIComponent(input.confirmationNumber)}/mock-pay`;
    } else if (provider === 'stripe') {
      const session = await this.createStripeCheckout({
        mode: paymentMode,
        amount: depositDue.greaterThan(0) ? depositDue : new Decimal('1.00'),
        currency: input.currencyCode,
        confirmationNumber: input.confirmationNumber,
        guestEmail: input.guestEmail,
        successUrl: `${publicBase}/api/v1/connect/bookings/${encodeURIComponent(input.confirmationNumber)}/payment-return?status=success`,
        cancelUrl: `${publicBase}/api/v1/connect/bookings/${encodeURIComponent(input.confirmationNumber)}/payment-return?status=cancel`,
        // guarantee with zero deposit still needs SetupIntent
        depositDue,
      });
      pspSessionId = session.id;
      paymentUrl = session.url!;
    } else {
      // Redsys / Worldline: expose a Connect return URL that the gateway can open;
      // full redirect form fields are available via payment-status.nextAction when wired.
      pspSessionId = `${provider}_${input.confirmationNumber}`;
      paymentUrl = `${publicBase}/api/v1/connect/bookings/${encodeURIComponent(input.confirmationNumber)}/hosted-pay`;
    }

    try {
      const [row] = await this.db
        .insert(connectPaymentSessions)
        .values({
          propertyId: input.propertyId,
          confirmationNumber: input.confirmationNumber,
          reservationId: input.reservationId,
          bookingId: input.bookingId,
          folioId: folio.id,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          paymentMode,
          status: 'pending',
          psp: provider === 'mock' ? 'mock' : provider,
          pspSessionId,
          paymentUrl,
          depositAmount: depositDue.toFixed(2),
          currencyCode: input.currencyCode,
          clientPlatform: input.clientPlatform ?? null,
          expiresAt,
        })
        .returning();
      return this.toPublicSession(row);
    } catch (err: any) {
      // Unique race on idempotency — re-read
      if (String(err?.message ?? err).includes('unique') || err?.code === '23505') {
        const again = await this.findByIdempotency(input.propertyId, input.idempotencyKey);
        if (again) {
          if (again.requestHash !== input.requestHash) {
            throw new ConflictException('Idempotency-Key reused with a different booking payload');
          }
          return this.toPublicSession(again);
        }
      }
      throw err;
    }
  }

  private async createStripeCheckout(input: {
    mode: ConnectPaymentMode;
    amount: Decimal;
    currency: string;
    confirmationNumber: string;
    guestEmail: string;
    successUrl: string;
    cancelUrl: string;
    depositDue: Decimal;
  }): Promise<Stripe.Checkout.Session> {
    if (!this.stripe) throw new BadRequestException('Stripe is not configured');

    if (input.mode === 'guarantee' || input.depositDue.lessThanOrEqualTo(0)) {
      return this.stripe.checkout.sessions.create({
        mode: 'setup',
        customer_email: input.guestEmail,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: {
          confirmationNumber: input.confirmationNumber,
          paymentMode: 'guarantee',
        },
      });
    }

    const amountCents = Math.round(input.amount.mul(100).toNumber());
    return this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: input.guestEmail,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: amountCents,
            product_data: {
              name: `Hotel deposit ${input.confirmationNumber}`,
            },
          },
        },
      ],
      payment_intent_data: input.mode === 'authorize'
        ? { capture_method: 'manual', metadata: { confirmationNumber: input.confirmationNumber } }
        : { metadata: { confirmationNumber: input.confirmationNumber } },
      metadata: {
        confirmationNumber: input.confirmationNumber,
        paymentMode: input.mode,
      },
    });
  }

  async getPaymentStatus(confirmationNumber: string) {
    const [session] = await this.db
      .select()
      .from(connectPaymentSessions)
      .where(eq(connectPaymentSessions.confirmationNumber, confirmationNumber));

    if (!session) {
      // pay_at_property bookings have no session — treat as paid/none
      const [booking] = await this.db
        .select()
        .from(bookings)
        .where(eq(bookings.confirmationNumber, confirmationNumber));
      if (!booking) throw new NotFoundException(`Booking ${confirmationNumber} not found`);
      const [reservation] = await this.db
        .select()
        .from(reservations)
        .where(and(eq(reservations.bookingId, booking.id), eq(reservations.propertyId, booking.propertyId)));
      return {
        confirmationNumber,
        paymentStatus: reservation?.status === 'confirmed' ? 'paid' : 'none',
        paymentMode: null,
        status: reservation?.status ?? 'unknown',
        paymentUrl: null,
      };
    }

    if (session.status === 'pending') {
      if (new Date(session.expiresAt) < new Date()) {
        await this.expireSession(confirmationNumber);
        const [expired] = await this.db
          .select()
          .from(connectPaymentSessions)
          .where(eq(connectPaymentSessions.confirmationNumber, confirmationNumber));
        return this.toPublicSession(expired ?? session);
      }
      await this.reconcileWithPsp(session);
      const [fresh] = await this.db
        .select()
        .from(connectPaymentSessions)
        .where(eq(connectPaymentSessions.confirmationNumber, confirmationNumber));
      return this.toPublicSession(fresh ?? session);
    }

    return this.toPublicSession(session);
  }

  /** Idempotent confirm used by LLM confirmPayment tool. */
  async confirmPayment(confirmationNumber: string) {
    const status = await this.getPaymentStatus(confirmationNumber);
    if (status.paymentStatus === 'paid' || status.status === 'paid') {
      return { ...status, confirmed: true };
    }
    if (status.paymentStatus === 'expired' || status.status === 'expired' || status.status === 'voided') {
      return { ...status, confirmed: false };
    }
    if (status.paymentStatus === 'failed' || status.status === 'failed') {
      return { ...status, confirmed: false };
    }
    // Still pending after reconcile
    return { ...status, confirmed: false };
  }

  /** Mock-pay helper for staging/dev (no card). */
  async mockPay(confirmationNumber: string) {
    const provider = resolvePaymentGatewayProvider(this.configService);
    if (provider !== 'mock' && this.configService.get('STRIPE_MODE', 'mock') !== 'mock') {
      throw new BadRequestException('mock-pay is only available when PAYMENT_GATEWAY/STRIPE_MODE is mock');
    }
    const [session] = await this.db
      .select()
      .from(connectPaymentSessions)
      .where(eq(connectPaymentSessions.confirmationNumber, confirmationNumber));
    if (!session) throw new NotFoundException('Payment session not found');
    if (session.status === 'paid') return this.toPublicSession(session);
    return this.markPaid(session, `mock_evt_${confirmationNumber}`);
  }

  /** Stripe webhook bridge (CONNECT_CHECKOUT_STRIPE_HANDLER). */
  async handleCheckoutSessionCompleted(
    eventId: string,
    sessionObj: {
      id: string;
      metadata?: Record<string, string> | null;
      mode?: string;
      payment_status?: string | null;
    },
  ) {
    return this.handleStripeCheckoutCompleted(eventId, sessionObj);
  }

  async handleStripeCheckoutCompleted(eventId: string, sessionObj: {
    id: string;
    metadata?: Record<string, string> | null;
    mode?: string;
    payment_status?: string | null;
  }) {
    const confirmationNumber = sessionObj.metadata?.['confirmationNumber'];
    if (!confirmationNumber) return;
    const [session] = await this.db
      .select()
      .from(connectPaymentSessions)
      .where(eq(connectPaymentSessions.confirmationNumber, confirmationNumber));
    if (!session) return;
    if ((session.pspEventIds as string[] | null)?.includes(eventId)) {
      return this.toPublicSession(session);
    }
    if (session.status === 'paid') return this.toPublicSession(session);
    const ok = sessionObj.payment_status === 'paid' || sessionObj.mode === 'setup';
    if (!ok) return this.toPublicSession(session);
    return this.markPaid(session, eventId);
  }

  private async reconcileWithPsp(session: typeof connectPaymentSessions.$inferSelect) {
    if (session.psp === 'mock') {
      // Mock stays pending until mock-pay or TTL
      return;
    }
    if (session.psp === 'stripe' && this.stripe && session.pspSessionId) {
      try {
        const cs = await this.stripe.checkout.sessions.retrieve(session.pspSessionId);
        if (cs.status === 'complete' && (cs.payment_status === 'paid' || cs.mode === 'setup')) {
          await this.markPaid(session, `reconcile_${cs.id}`);
        } else if (cs.status === 'expired') {
          await this.expireSession(session.confirmationNumber);
        }
      } catch (err: any) {
        this.logger.warn(`Stripe reconcile failed for ${session.confirmationNumber}: ${err.message}`);
      }
    }
  }

  private async markPaid(
    session: typeof connectPaymentSessions.$inferSelect,
    eventId: string,
  ) {
    return this.db.transaction(async (tx: any) => {
      const eventIds = [...(session.pspEventIds ?? [])];
      if (eventIds.includes(eventId)) {
        const [current] = await tx.select().from(connectPaymentSessions)
          .where(eq(connectPaymentSessions.id, session.id));
        return this.toPublicSession(current);
      }
      eventIds.push(eventId);

      const [updated] = await tx
        .update(connectPaymentSessions)
        .set({
          status: 'paid',
          pspEventIds: eventIds,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connectPaymentSessions.id, session.id),
            eq(connectPaymentSessions.status, 'pending'),
          ),
        )
        .returning();

      if (!updated) {
        const [current] = await tx.select().from(connectPaymentSessions)
          .where(eq(connectPaymentSessions.id, session.id));
        return this.toPublicSession(current);
      }

      const [reservation] = await tx
        .update(reservations)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(
          and(
            eq(reservations.id, session.reservationId),
            eq(reservations.propertyId, session.propertyId),
            eq(reservations.status, 'pending'),
          ),
        )
        .returning();

      if (
        session.folioId
        && new Decimal(session.depositAmount).greaterThan(0)
        && session.paymentMode !== 'guarantee'
      ) {
        const existingDeposits = await tx
          .select({ id: depositLedgerEntries.id })
          .from(depositLedgerEntries)
          .where(
            and(
              eq(depositLedgerEntries.reservationId, session.reservationId),
              eq(depositLedgerEntries.propertyId, session.propertyId),
            ),
          );
        if (existingDeposits.length === 0) {
          await tx.insert(depositLedgerEntries).values({
            propertyId: session.propertyId,
            reservationId: session.reservationId,
            paymentId: session.paymentId,
            amount: session.depositAmount,
            currencyCode: session.currencyCode,
            status: 'held',
            isRefundable: session.paymentMode === 'authorize',
          });
        }
      }

      return this.toPublicSession({
        ...updated,
        status: 'paid',
        reservationStatus: reservation?.status ?? 'confirmed',
      });
    }).then(async (result: ReturnType<ConnectPaymentService['toPublicSession']>) => {
      await this.webhookService.emit(
        'reservation.confirmed',
        'reservation',
        session.reservationId,
        { confirmationNumber: session.confirmationNumber, paymentMode: session.paymentMode },
        session.propertyId,
      );
      return result;
    });
  }

  async expireSession(confirmationNumber: string) {
    const [session] = await this.db
      .select()
      .from(connectPaymentSessions)
      .where(eq(connectPaymentSessions.confirmationNumber, confirmationNumber));
    if (!session || session.status !== 'pending') return;

    // Void Stripe auth if applicable
    if (session.psp === 'stripe' && this.stripe && session.pspSessionId && session.paymentMode === 'authorize') {
      try {
        const cs = await this.stripe.checkout.sessions.retrieve(session.pspSessionId, {
          expand: ['payment_intent'],
        });
        const pi = cs.payment_intent;
        if (typeof pi === 'object' && pi && 'id' in pi && pi.status === 'requires_capture') {
          await this.stripe.paymentIntents.cancel(pi.id);
        }
      } catch (err: any) {
        this.logger.warn(`Void on expire failed: ${err.message}`);
      }
    }

    await this.db.transaction(async (tx: any) => {
      await tx
        .update(connectPaymentSessions)
        .set({
          status: session.paymentMode === 'authorize' ? 'voided' : 'expired',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connectPaymentSessions.id, session.id),
            eq(connectPaymentSessions.status, 'pending'),
          ),
        );

      await tx
        .update(reservations)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: 'Payment session expired',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reservations.id, session.reservationId),
            eq(reservations.propertyId, session.propertyId),
            eq(reservations.status, 'pending'),
          ),
        );
    });
  }

  /** Cron-friendly: expire all overdue pending sessions. */
  async expireOverdueSessions() {
    const rows = await this.db
      .select({ confirmationNumber: connectPaymentSessions.confirmationNumber })
      .from(connectPaymentSessions)
      .where(
        and(
          eq(connectPaymentSessions.status, 'pending'),
          lt(connectPaymentSessions.expiresAt, new Date()),
        ),
      );
    for (const row of rows) {
      await this.expireSession(row.confirmationNumber);
    }
    return { expired: rows.length };
  }

  toPublicSession(session: any) {
    return {
      confirmationNumber: session.confirmationNumber,
      paymentStatus: session.status === 'paid' ? 'paid' : session.status,
      status: session.status,
      paymentMode: session.paymentMode as ConnectPaymentMode,
      paymentUrl: session.paymentUrl ?? null,
      depositDue: Number(session.depositAmount ?? 0),
      currencyCode: session.currencyCode,
      processor: session.psp,
      expiresAt: session.expiresAt instanceof Date
        ? session.expiresAt.toISOString()
        : session.expiresAt,
    };
  }
}
