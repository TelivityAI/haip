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
import { payments } from '@telivityhaip/database';
import { Public } from '../auth/public.decorator';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RedsysCredentialsService } from './redsys-credentials.service';
import {
  decodeMerchantParameters,
  isRedsysSuccessResponse,
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

    let params: Record<string, string>;
    try {
      params = decodeMerchantParameters(String(merchantParameters));
    } catch (err) {
      this.logger.warn(`Redsys notification decode failed: ${String(err)}`);
      return res.status(HttpStatus.BAD_REQUEST).send('invalid parameters');
    }

    const orderId = params['Ds_Order'] ?? params['DS_ORDER'] ?? '';
    if (!orderId) {
      return res.status(HttpStatus.BAD_REQUEST).send('missing order');
    }

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

    const dsResponse = params['Ds_Response'] ?? params['DS_RESPONSE'];
    const success = isRedsysSuccessResponse(dsResponse);

    if (payment.status === 'authorized' || payment.status === 'captured') {
      return res.status(HttpStatus.OK).send('OK');
    }

    if (success) {
      const [updated] = await this.db
        .update(payments)
        .set({
          status: 'authorized',
          notes: payment.notes
            ? `${payment.notes}; redsys Ds_Response=${dsResponse}`
            : `redsys Ds_Response=${dsResponse}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payments.id, payment.id),
            eq(payments.propertyId, payment.propertyId),
            eq(payments.status, 'pending'),
          ),
        )
        .returning();

      if (updated) {
        await this.webhookService.emit(
          'payment.received',
          'payment',
          updated.id,
          {
            folioId: updated.folioId,
            status: 'authorized',
            amount: updated.amount,
            gatewayProvider: 'redsys',
          },
          updated.propertyId,
        );
        this.logger.log(
          `Redsys order=${orderId} authorized payment=${updated.id}`,
        );
      }
    } else {
      await this.db
        .update(payments)
        .set({
          status: 'failed',
          notes: `redsys Ds_Response=${dsResponse ?? 'unknown'}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payments.id, payment.id),
            eq(payments.propertyId, payment.propertyId),
            eq(payments.status, 'pending'),
          ),
        );

      await this.webhookService.emit(
        'payment.failed',
        'payment',
        payment.id,
        {
          folioId: payment.folioId,
          error: `Ds_Response=${dsResponse ?? 'unknown'}`,
        },
        payment.propertyId,
      );
      this.logger.warn(
        `Redsys order=${orderId} failed Ds_Response=${dsResponse}`,
      );
    }

    return res.status(HttpStatus.OK).send('OK');
  }
}
