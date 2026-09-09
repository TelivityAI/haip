import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  Inject,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { and, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { auditLogs, depositLedgerEntries, folios, payments, reservations } from '@telivityhaip/database';
import { Public } from '../auth/public.decorator';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService, type WebhookPayload } from '../webhook/webhook.service';
import { assertTransition } from '../reservation/reservation-state-machine';
import { RedsysCredentialsService } from './redsys-credentials.service';
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
    await this.finalizeAuthorization(payment.id, payment.propertyId, dsResponse, success);
    return res.status(HttpStatus.OK).send('OK');
  }

  private async finalizeAuthorization(
    paymentId: string,
    propertyId: string,
    response: string,
    success: boolean,
  ): Promise<void> {
    const notifications: WebhookPayload[] = await this.db.transaction(async (tx: any) => {
      // Conditional UPDATE locks the payment until commit. Competing callbacks
      // then observe a terminal status and perform no deposit, audit or confirm.
      const [payment] = await tx
        .update(payments)
        .set({
          status: success ? 'authorized' : 'failed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payments.id, paymentId),
            eq(payments.propertyId, propertyId),
            eq(payments.gatewayProvider, 'redsys'),
            eq(payments.status, 'pending'),
          ),
        )
        .returning();
      if (!payment) return [];

      const pendingEvents: WebhookPayload[] = [];
      const addEvent = (event: WebhookPayload['event'], entityType: string, entityId: string, data: Record<string, unknown>) => {
        pendingEvents.push({ event, entityType, entityId, propertyId, data, timestamp: new Date().toISOString(), logicalEventId: randomUUID() });
      };
      addEvent(success ? 'payment.received' : 'payment.failed', 'payment', payment.id,
        success
          ? { folioId: payment.folioId, status: 'authorized', amount: payment.amount, gatewayProvider: 'redsys' }
          : { folioId: payment.folioId, error: `Ds_Response=${response || 'unknown'}` });

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

        // Same ownership, amount and held-liability invariants as recordDeposit;
        // writes and their audit events share the payment's transaction.
        const [deposit] = await tx.insert(depositLedgerEntries).values({
          propertyId, reservationId: reservation.id, paymentId: payment.id,
          amount: new Decimal(payment.amount).toFixed(2), currencyCode: payment.currencyCode,
          status: 'held', isRefundable: intent.isRefundable,
        }).returning();
        addEvent('deposit.received', 'deposit', deposit.id, {
          amount: deposit.amount, status: deposit.status, isRefundable: deposit.isRefundable,
        });

        // A payment arriving after cancellation must not resurrect the stay.
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

    // Consumers can only observe the completed payment/deposit/reservation set.
    for (const payload of notifications) {
      await this.webhookService.dispatchPersisted(payload, payload.logicalEventId!);
    }
  }
}
