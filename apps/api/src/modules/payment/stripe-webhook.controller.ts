import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { eq, and } from 'drizzle-orm';
import { payments } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import Stripe from 'stripe';

/**
 * Stripe Webhook Controller.
 *
 * Handles asynchronous payment status updates from Stripe.
 * Uses raw body for signature verification (Stripe requirement).
 *
 * Events handled:
 * - payment_intent.succeeded → captured
 * - payment_intent.payment_failed → failed
 * - payment_intent.canceled → voided
 * - charge.refunded → refunded
 */
@ApiTags('webhooks')
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);
  private stripe: Stripe | null = null;
  private webhookSecret: string | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly folioService: FolioService,
    private readonly configService: ConfigService,
  ) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? null;

    if (secretKey) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2025-03-31.basil',
        typescript: true,
      });
    }
  }

  @Public()
  @Post()
  @ApiExcludeEndpoint() // Hide from Swagger — this is for Stripe only
  async handleWebhook(@Req() req: any, @Res() res: any) {
    const stripeMode = this.configService.get<string>('STRIPE_MODE', 'mock');

    if (stripeMode === 'mock' || !this.stripe) {
      // In mock mode, webhooks are not processed
      return res.status(200).json({ received: true, mode: 'mock' });
    }

    // Verify webhook signature
    const signature = req.headers['stripe-signature'] as string;
    if (!signature || !this.webhookSecret) {
      throw new BadRequestException('Missing Stripe signature or webhook secret');
    }

    let event: Stripe.Event;
    try {
      // Stripe requires the exact raw request body for signature verification.
      // main.ts installs express.raw({ type: 'application/json' }) for this
      // route, which places the raw Buffer on req.body (and also exposes it
      // via req.rawBody on some Nest versions). Prefer the Buffer from req.body;
      // fall back to req.rawBody to stay resilient across middleware orders.
      const rawBody: Buffer | string | undefined = Buffer.isBuffer(req.body)
        ? (req.body as Buffer)
        : ((req as any).rawBody as Buffer | string | undefined);
      if (!rawBody) {
        throw new Error(
          'Raw body not available. Ensure express.raw() middleware is configured for /api/v1/webhooks/stripe in main.ts.',
        );
      }
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err: any) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
    }

    this.logger.log(`Stripe webhook received: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
          break;

        case 'charge.refunded':
          await this.handleChargeRefunded(event.data.object as Stripe.Charge);
          break;

        default:
          this.logger.debug(`Unhandled event type: ${event.type}`);
      }
    } catch (err: any) {
      this.logger.error(`Error processing webhook ${event.type}: ${err.message}`, err.stack);
      // Return 200 to prevent Stripe retries for processing errors
      // The error is logged for manual investigation
    }

    return res.status(200).json({ received: true });
  }

  private async handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
    const payment = await this.findPaymentByGatewayTransactionId(pi.id);
    if (!payment) {
      this.logger.warn(`No payment found for PaymentIntent ${pi.id}`);
      return;
    }

    if (payment.status === 'captured') {
      this.logger.debug(`Payment ${payment.id} already captured, skipping`);
      return;
    }

    await this.db
      .update(payments)
      .set({ status: 'captured', processedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.propertyId, payment.propertyId)));

    // Recalculate folio balance after payment state change
    await this.folioService.recalculateBalance(payment.folioId, payment.propertyId);

    await this.webhookService.emit(
      'payment.received',
      'payment',
      payment.id,
      { folioId: payment.folioId, status: 'captured', stripeEvent: pi.id },
      payment.propertyId,
    );

    this.logger.log(`Payment ${payment.id} updated to captured via webhook`);
  }

  private async handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
    const payment = await this.findPaymentByGatewayTransactionId(pi.id);
    if (!payment) return;

    if (payment.status === 'failed') return;

    const errorMessage = pi.last_payment_error?.message ?? 'Payment failed';

    await this.db
      .update(payments)
      .set({ status: 'failed', notes: errorMessage, updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.propertyId, payment.propertyId)));

    // Recalculate folio balance after payment state change
    await this.folioService.recalculateBalance(payment.folioId, payment.propertyId);

    await this.webhookService.emit(
      'payment.failed',
      'payment',
      payment.id,
      { folioId: payment.folioId, error: errorMessage, stripeEvent: pi.id },
      payment.propertyId,
    );

    this.logger.log(`Payment ${payment.id} updated to failed via webhook`);
  }

  private async handlePaymentIntentCanceled(pi: Stripe.PaymentIntent) {
    const payment = await this.findPaymentByGatewayTransactionId(pi.id);
    if (!payment) return;

    if (payment.status === 'voided') return;

    await this.db
      .update(payments)
      .set({ status: 'voided', updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.propertyId, payment.propertyId)));

    // Recalculate folio balance after payment state change
    await this.folioService.recalculateBalance(payment.folioId, payment.propertyId);

    await this.webhookService.emit(
      'payment.failed',
      'payment',
      payment.id,
      { folioId: payment.folioId, status: 'voided', stripeEvent: pi.id },
      payment.propertyId,
    );

    this.logger.log(`Payment ${payment.id} updated to voided via webhook`);
  }

  private async handleChargeRefunded(charge: Stripe.Charge) {
    const piId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

    if (!piId) return;

    const payment = await this.findPaymentByGatewayTransactionId(piId);
    if (!payment) return;

    if (['refunded', 'partially_refunded'].includes(payment.status)) return;

    const status = charge.amount_refunded < charge.amount ? 'partially_refunded' : 'refunded';

    await this.db
      .update(payments)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.propertyId, payment.propertyId)));

    // Recalculate folio balance after refund
    await this.folioService.recalculateBalance(payment.folioId, payment.propertyId);

    await this.webhookService.emit(
      'payment.refunded',
      'payment',
      payment.id,
      { folioId: payment.folioId, status, stripeEvent: charge.id },
      payment.propertyId,
    );

    this.logger.log(`Payment ${payment.id} updated to ${status} via webhook`);
  }

  private async findPaymentByGatewayTransactionId(transactionId: string) {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.gatewayTransactionId, transactionId));
    return payment ?? null;
  }
}
