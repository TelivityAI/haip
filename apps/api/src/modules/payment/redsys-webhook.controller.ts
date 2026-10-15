import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  Inject,
  HttpStatus,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { and, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { payments } from '@telivityhaip/database';
import { Public } from '../auth/public.decorator';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RedsysCredentialsService } from './redsys-credentials.service';
import { finalizeHostedAuthorization } from './hosted-authorization-finalizer';
import {
  decodeMerchantParameters,
  REDSYS_SIGNATURE_VERSION,
  redsysAmountString,
  redsysCurrencyCode,
  verifyMerchantParametersSignature,
} from './gateways/redsys-crypto';

/**
 * Redsys MerchantURL notification receiver.
 *
 * Redsys POSTs `application/x-www-form-urlencoded` with
 * Ds_MerchantParameters, Ds_Signature, Ds_SignatureVersion.
 * Browser URLOK/URLKO alone must never authorize a payment.
 */
@ApiTags('webhooks')
@Controller('webhooks/redsys')
export class RedsysWebhookController {
  private readonly logger = new Logger(RedsysWebhookController.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly credentialsService: RedsysCredentialsService,
  ) {}

  @Public()
  @Post()
  @ApiExcludeEndpoint()
  async handleNotification(@Req() req: any, @Res() res: any) {
    const body = req.body ?? {};
    const merchantParameters = body.Ds_MerchantParameters;
    const signature = body.Ds_Signature;

    if (!merchantParameters || !signature) {
      this.logger.warn('Redsys notification missing parameters or signature');
      return res.status(HttpStatus.BAD_REQUEST).send('missing fields');
    }
    if (body.Ds_SignatureVersion !== REDSYS_SIGNATURE_VERSION) {
      return res.status(HttpStatus.BAD_REQUEST).send('unsupported signature version');
    }

    let params: Record<string, string>;
    try {
      params = decodeMerchantParameters(String(merchantParameters));
      if (!params || typeof params !== 'object' || Array.isArray(params)
        || Object.values(params).some((value) => typeof value !== 'string')) {
        throw new Error('Expected string merchant parameters');
      }
    } catch (err) {
      this.logger.warn(`Redsys notification decode failed: ${String(err)}`);
      return res.status(HttpStatus.BAD_REQUEST).send('invalid parameters');
    }

    const orderId = params['Ds_Order'] ?? params['DS_ORDER'] ?? '';
    if (!orderId) {
      return res.status(HttpStatus.BAD_REQUEST).send('missing order');
    }

    // Internal provider receiver: the order identifies the tenant before its
    // property-specific signature is verified. All later queries are scoped.
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.gatewayTransactionId, orderId),
          eq(payments.gatewayProvider, 'redsys'),
        ),
      )
      .limit(1);

    if (!payment) {
      this.logger.warn(`Redsys notification for unknown order=${orderId}`);
      return res.status(HttpStatus.OK).send('OK');
    }

    const creds = await this.credentialsService.resolveForProperty(
      payment.propertyId,
    );
    if (!creds) {
      this.logger.error(
        `Redsys notification order=${orderId} — no credentials for property ${payment.propertyId}`,
      );
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('no credentials');
    }

    const signatureOk = verifyMerchantParametersSignature(
      String(merchantParameters),
      String(signature),
      creds.secretKey,
      orderId,
    );
    if (!signatureOk) {
      this.logger.warn(
        `Redsys notification signature mismatch order=${orderId}`,
      );
      return res.status(HttpStatus.BAD_REQUEST).send('bad signature');
    }

    const amount = params['Ds_Amount'] ?? params['DS_AMOUNT'] ?? '';
    const terminal = params['Ds_Terminal'] ?? params['DS_TERMINAL'] ?? '';
    if (!/^\d+$/.test(amount)
      || !new Decimal(amount).equals(redsysAmountString(payment.amount, payment.currencyCode))
      || (params['Ds_Currency'] ?? params['DS_CURRENCY']) !== redsysCurrencyCode(payment.currencyCode)
      || (params['Ds_MerchantCode'] ?? params['DS_MERCHANTCODE']) !== creds.merchantCode
      || !/^\d+$/.test(terminal) || Number(terminal) !== Number(creds.terminal)
      || (params['Ds_TransactionType'] ?? params['DS_TRANSACTIONTYPE']) !== '1'
    ) {
      return res.status(HttpStatus.BAD_REQUEST).send('authorization mismatch');
    }

    const dsResponse = params['Ds_Response'] ?? params['DS_RESPONSE'] ?? '';
    // This receiver completes preauthorization (type 1), not capture/refund/void.
    const success = /^\d{4}$/.test(dsResponse) && Number(dsResponse) < 100;
    const notifications = await finalizeHostedAuthorization(this.db, {
      paymentId: payment.id,
      propertyId: payment.propertyId,
      gatewayProvider: 'redsys',
      success,
      failureReason: `Ds_Response=${dsResponse || 'unknown'}`,
    });
    for (const payload of notifications) {
      await this.webhookService.dispatchPersisted(payload, payload.logicalEventId!);
    }
    return res.status(HttpStatus.OK).send('OK');
  }
}
