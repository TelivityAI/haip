import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentGateway,
  PaymentGatewayCallOptions,
  PaymentGatewayResult,
} from '../interfaces/payment-gateway.interface';
import { createConsolePaymentGateway } from './console-payment-gateway';
import { gatewayJsonRequest, type GatewayFetchFn } from './payment-gateway-http';
import {
  REDSYS_REDIRECT_URLS,
  REDSYS_REST_URLS,
  REDSYS_SANDBOX,
  REDSYS_SIGNATURE_VERSION,
  decodeMerchantParameters,
  encodeMerchantParameters,
  generateRedsysOrderId,
  isRedsysSuccessResponse,
  redsysAmountString,
  redsysCurrencyCode,
  signMerchantParameters,
  verifyMerchantParametersSignature,
} from './redsys-crypto';

export type RedsysEnvironment = 'test' | 'live';

export interface RedsysMerchantCredentials {
  merchantCode: string;
  terminal: string;
  secretKey: string;
  environment: RedsysEnvironment;
}

interface RedsysRestResponse {
  Ds_MerchantParameters?: string;
  Ds_Signature?: string;
  Ds_SignatureVersion?: string;
  errorCode?: string;
  error?: string;
}

/**
 * Redsys TPV Virtual (Spain).
 *
 * Authorize → hosted redirect (`realizarPago`) returning `nextAction` for the
 * client to auto-POST. Capture / void / refund → `trataPeticionREST`.
 *
 * Credentials: `options.merchantCredentials` (per-property Integrations config),
 * else env `REDSYS_MERCHANT_CODE` / `REDSYS_TERMINAL` / `REDSYS_SECRET_KEY` /
 * `REDSYS_ENV`. Missing credentials → console (mock) mode.
 */
@Injectable()
export class RedsysGateway implements PaymentGateway {
  private readonly logger = new Logger(RedsysGateway.name);
  private readonly envCredentials: RedsysMerchantCredentials | null;
  private readonly fetchFn: GatewayFetchFn;
  private readonly consoleDelegate: PaymentGateway;

  constructor(
    configService: ConfigService,
    deps?: { fetchFn?: GatewayFetchFn },
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    this.consoleDelegate = createConsolePaymentGateway('Redsys');

    const merchantCode = configService.get<string>('REDSYS_MERCHANT_CODE')?.trim();
    const terminal = configService.get<string>('REDSYS_TERMINAL')?.trim() || '001';
    const secretKey = configService.get<string>('REDSYS_SECRET_KEY')?.trim();
    const environmentRaw = configService
      .get<string>('REDSYS_ENV', 'test')
      ?.trim()
      .toLowerCase();
    const environment: RedsysEnvironment =
      environmentRaw === 'live' ? 'live' : 'test';

    this.envCredentials =
      merchantCode && secretKey
        ? { merchantCode, terminal, secretKey, environment }
        : null;
  }

  static sandboxCredentials(): RedsysMerchantCredentials {
    return {
      merchantCode: REDSYS_SANDBOX.merchantCode,
      terminal: REDSYS_SANDBOX.terminal,
      secretKey: REDSYS_SANDBOX.secretKey,
      environment: 'test',
    };
  }

  resolveCredentials(
    options?: PaymentGatewayCallOptions,
  ): RedsysMerchantCredentials | null {
    const override = options?.merchantCredentials;
    if (override?.merchantCode && override.secretKey) {
      return {
        merchantCode: override.merchantCode,
        terminal: override.terminal || '001',
        secretKey: override.secretKey,
        environment: override.environment === 'live' ? 'live' : 'test',
      };
    }
    return this.envCredentials;
  }

  authorize(
    token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return this.consoleDelegate.authorize(token, amount, currency, options);
    }
    return Promise.resolve(
      this.buildRedirectAuthorize(amount, currency, creds, options),
    );
  }

  capture(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return this.consoleDelegate.capture(transactionId, amount, options);
    }
    return this.restOperation({
      creds,
      orderId: transactionId,
      transactionType: '2',
      amount,
      currency: options?.currencyCode ?? 'EUR',
      options,
    });
  }

  void(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return this.consoleDelegate.void(transactionId, options);
    }
    return this.restOperation({
      creds,
      orderId: transactionId,
      transactionType: '9',
      currency: options?.currencyCode ?? 'EUR',
      options,
    });
  }

  refund(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return this.consoleDelegate.refund(transactionId, amount, options);
    }
    return this.restOperation({
      creds,
      orderId: transactionId,
      transactionType: '3',
      amount,
      currency: options?.currencyCode ?? 'EUR',
      options,
    });
  }

  verifyNotification(
    merchantParameters: string,
    signature: string,
    secretKey: string,
  ): { ok: boolean; params: Record<string, string> } {
    const params = decodeMerchantParameters(merchantParameters);
    const orderId = params['Ds_Order'] ?? params['DS_ORDER'] ?? '';
    const ok = verifyMerchantParametersSignature(
      merchantParameters,
      signature,
      secretKey,
      orderId,
    );
    return { ok, params };
  }

  private buildRedirectAuthorize(
    amount: number,
    currency: string,
    creds: RedsysMerchantCredentials,
    options?: PaymentGatewayCallOptions,
  ): PaymentGatewayResult {
    if (
      !options?.redirect?.merchantUrl ||
      !options.redirect.urlOk ||
      !options.redirect.urlKo
    ) {
      return {
        success: false,
        transactionId: '',
        errorMessage:
          'Redsys authorize requires redirect.merchantUrl, redirect.urlOk, and redirect.urlKo',
      };
    }

    const orderId = generateRedsysOrderId();
    const params: Record<string, string> = {
      DS_MERCHANT_AMOUNT: redsysAmountString(amount),
      DS_MERCHANT_ORDER: orderId,
      DS_MERCHANT_MERCHANTCODE: creds.merchantCode,
      DS_MERCHANT_CURRENCY: redsysCurrencyCode(currency),
      DS_MERCHANT_TRANSACTIONTYPE: '1',
      DS_MERCHANT_TERMINAL: creds.terminal,
      DS_MERCHANT_MERCHANTURL: options.redirect.merchantUrl,
      DS_MERCHANT_URLOK: options.redirect.urlOk,
      DS_MERCHANT_URLKO: options.redirect.urlKo,
    };

    const merchantParameters = encodeMerchantParameters(params);
    const signature = signMerchantParameters(
      merchantParameters,
      creds.secretKey,
      orderId,
    );

    this.logger.log(`Redsys redirect authorize prepared order=${orderId}`);

    return {
      success: true,
      transactionId: orderId,
      providerStatus: 'requires_action',
      nextAction: {
        type: 'redirect',
        url: REDSYS_REDIRECT_URLS[creds.environment],
        method: 'POST',
        formFields: {
          Ds_SignatureVersion: REDSYS_SIGNATURE_VERSION,
          Ds_MerchantParameters: merchantParameters,
          Ds_Signature: signature,
        },
      },
    };
  }

  private async restOperation(input: {
    creds: RedsysMerchantCredentials;
    orderId: string;
    transactionType: string;
    amount?: number;
    currency?: string;
    options?: PaymentGatewayCallOptions;
  }): Promise<PaymentGatewayResult> {
    const { creds, orderId, transactionType, amount, currency, options } = input;
    const params: Record<string, string> = {
      DS_MERCHANT_ORDER: orderId,
      DS_MERCHANT_MERCHANTCODE: creds.merchantCode,
      DS_MERCHANT_TERMINAL: creds.terminal,
      DS_MERCHANT_TRANSACTIONTYPE: transactionType,
      DS_MERCHANT_CURRENCY: redsysCurrencyCode(currency ?? 'EUR'),
    };
    if (amount !== undefined) {
      params['DS_MERCHANT_AMOUNT'] = redsysAmountString(amount);
    }

    const merchantParameters = encodeMerchantParameters(params);
    const signature = signMerchantParameters(
      merchantParameters,
      creds.secretKey,
      orderId,
    );
    const restUrl =
      process.env['REDSYS_API_BASE']?.replace(/\/$/, '') ||
      REDSYS_REST_URLS[creds.environment];

    const res = await gatewayJsonRequest<RedsysRestResponse>(
      restUrl,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: JSON.stringify({
          Ds_SignatureVersion: REDSYS_SIGNATURE_VERSION,
          Ds_MerchantParameters: merchantParameters,
          Ds_Signature: signature,
        }),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    if (!res.ok || !res.data?.Ds_MerchantParameters) {
      return {
        success: false,
        transactionId: orderId,
        errorMessage:
          res.data?.errorCode ||
          res.data?.error ||
          res.errorMessage ||
          'Redsys REST call failed',
      };
    }

    if (
      res.data.Ds_Signature &&
      !verifyMerchantParametersSignature(
        res.data.Ds_MerchantParameters,
        res.data.Ds_Signature,
        creds.secretKey,
        orderId,
      )
    ) {
      return {
        success: false,
        transactionId: orderId,
        errorMessage: 'Redsys response signature mismatch',
      };
    }

    const decoded = decodeMerchantParameters(res.data.Ds_MerchantParameters);
    const dsResponse = decoded['Ds_Response'] ?? decoded['DS_RESPONSE'];
    if (!isRedsysSuccessResponse(dsResponse)) {
      return {
        success: false,
        transactionId: orderId,
        errorMessage: `Redsys declined with Ds_Response=${dsResponse ?? 'unknown'}`,
      };
    }

    this.logger.log(
      `Redsys REST type=${transactionType} order=${orderId} response=${dsResponse}`,
    );
    return {
      success: true,
      transactionId: orderId,
      providerStatus: 'succeeded',
    };
  }
}
