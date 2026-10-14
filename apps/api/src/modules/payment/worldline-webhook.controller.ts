import { createHmac } from 'node:crypto';
import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Logger,
  Inject,
  HttpStatus,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { and, eq, inArray } from 'drizzle-orm';
import { webhooks } from 'onlinepayments-sdk-nodejs';
import { payments } from '@telivityhaip/database';
import { Public } from '../auth/public.decorator';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { WorldlineCredentialsService } from './worldline-credentials.service';
import { finalizeHostedAuthorization } from './hosted-authorization-finalizer';
import { classifyHostedCheckout } from './gateways/worldline-status';

/**
 * Provider webhook. Signature is checked before any payment row changes.
 * Checkout completion uses the return-status read; this is the fallback.
 */
@ApiTags('webhooks')
@Controller('webhooks/worldline')
export class WorldlineWebhookController {
  private readonly logger = new Logger(WorldlineWebhookController.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly credentials: WorldlineCredentialsService,
    private readonly folioService: FolioService,
  ) {}

  @Public()
  @Get()
  @ApiExcludeEndpoint()
  verifyEndpoint(@Req() req: any, @Res() res: any) {
    const token = req.headers?.['x-gcs-webhooks-endpoint-verification'];
    if (typeof token !== 'string' || !token) {
      return res.status(HttpStatus.BAD_REQUEST).send('missing verification header');
    }
    return res.status(HttpStatus.OK).type('text/plain').send(token);
  }

  @Public()
  @Post()
  @ApiExcludeEndpoint()
  async handle(@Req() req: any, @Res() res: any) {
    const rawBody: Buffer | string | undefined = Buffer.isBuffer(req.body)
      ? req.body
      : (req.rawBody as Buffer | string | undefined);
    if (!rawBody) return res.status(HttpStatus.BAD_REQUEST).send('missing body');

    let event: {
      type?: string | null;
      merchantId?: string | null;
      payment?: {
        id?: string | null;
        status?: string | null;
        statusOutput?: { statusCode?: number | null; isAuthorized?: boolean | null; statusCategory?: string | null } | null;
        hostedCheckoutSpecificOutput?: { hostedCheckoutId?: string | null } | null;
      } | null;
    };
    try {
      event = await webhooks.init({
        getSecretKey: async (keyId: string) => {
          const secret = await this.credentials.webhookSecretForKeyId(keyId);
          if (!secret) throw new Error(`unknown webhook key ${keyId}`);
          return secret;
        },
      }).unmarshal(rawBody, req.headers ?? {});
    } catch (err) {
      this.logger.warn(`Webhook signature rejected: ${err instanceof Error ? err.message : 'invalid'}`);
      return res.status(HttpStatus.BAD_REQUEST).send('bad signature');
    }

    const paymentId = event.payment?.id ?? '';
    const hostedCheckoutId = event.payment?.hostedCheckoutSpecificOutput?.hostedCheckoutId ?? '';
    const ids = [paymentId, hostedCheckoutId].filter(Boolean);
    if (ids.length === 0) return res.status(HttpStatus.OK).send('OK');

    // The provider reference identifies the row. The signature was already
    // checked, and every later write is scoped by that row's propertyId.
    const [payment] = await this.db.select().from(payments).where(and(
      eq(payments.gatewayProvider, 'worldline'),
      inArray(payments.gatewayTransactionId, ids),
    )).limit(1);
    if (!payment) return res.status(HttpStatus.OK).send('OK');

    const creds = await this.credentials.resolveForProperty(payment.propertyId);
    if (creds && event.merchantId && event.merchantId !== creds.merchantId) {
      return res.status(HttpStatus.BAD_REQUEST).send('merchant mismatch');
    }

    const outcome = classifyHostedCheckout({
      paymentStatus: event.payment?.status,
      statusCode: event.payment?.statusOutput?.statusCode,
      isAuthorized: event.payment?.statusOutput?.isAuthorized,
      statusCategory: event.payment?.statusOutput?.statusCategory,
    });
    // Promoting without payment.id would store the hosted checkout id and
    // later capture/cancel/refund calls would target the wrong resource.
    const captured = event.type === 'payment.captured' && outcome === 'captured' && Boolean(paymentId);
    const promote = (event.type === 'payment.pending_capture' && outcome === 'authorized' && Boolean(paymentId)) || captured;
    const decline = event.type === 'payment.rejected'
      || (event.type === 'payment.cancelled' && outcome === 'failed');
    if (!promote && !decline) return res.status(HttpStatus.OK).send('OK');

    const notifications = await finalizeHostedAuthorization(this.db, {
      paymentId: payment.id,
      propertyId: payment.propertyId,
      gatewayProvider: 'worldline',
      success: promote,
      captured,
      cancelPendingReservation: true,
      failureReason: event.type ?? 'payment.rejected',
      gatewayTransactionId: paymentId || undefined,
    });
    for (const payload of notifications) {
      await this.webhookService.dispatchPersisted(payload, payload.logicalEventId!);
    }
    if (captured && notifications.length > 0 && payment.folioId) {
      await this.folioService.recalculateBalance(payment.folioId, payment.propertyId);
    }
    return res.status(HttpStatus.OK).send('OK');
  }
}

export function signWorldlineBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}
