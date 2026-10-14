import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { init, type Client } from 'onlinepayments-sdk-nodejs';
import type {
  PaymentGateway,
  PaymentGatewayCallOptions,
  PaymentGatewayResult,
} from '../interfaces/payment-gateway.interface';
import { toMinorUnits } from './payment-gateway-http';
import { classifyHostedCheckout, hostedCheckoutRedirectUrl } from './worldline-status';

export type WorldlineEnvironment = 'test' | 'live';

export interface WorldlineMerchantCredentials {
  merchantId: string;
  apiKeyId: string;
  secretApiKey: string;
  environment: WorldlineEnvironment;
}

const HOSTS: Record<WorldlineEnvironment, string> = {
  test: 'payment.preprod.direct.worldline-solutions.com',
  live: 'payment.direct.worldline-solutions.com',
};

export type WorldlineClientFactory = (
  creds: WorldlineMerchantCredentials,
) => Pick<Client, 'hostedCheckout' | 'payments'>;

interface SdkErrorBody {
  errors?: Array<{ message?: string | null; errorCode?: string | null }> | null;
}

/**
 * Online Payments hosted checkout.
 *
 * Authorize creates a hosted checkout in PRE_AUTHORIZATION (a hold). Capture,
 * cancel, and refund use the payment id returned after the guest pays.
 * Card data stays on the hosted page. Missing credentials fail closed.
 */
@Injectable()
export class WorldlineGateway implements PaymentGateway {
  private readonly logger = new Logger(WorldlineGateway.name);
  private readonly envCredentials: WorldlineMerchantCredentials | null;
  private readonly clientFactory: WorldlineClientFactory;

  constructor(
    configService: ConfigService,
    deps?: { clientFactory?: WorldlineClientFactory },
  ) {
    this.clientFactory = deps?.clientFactory ?? defaultClientFactory;
    const merchantId = configService.get<string>('WORLDLINE_MERCHANT_ID')?.trim();
    const apiKeyId = configService.get<string>('WORLDLINE_API_KEY_ID')?.trim();
    const secretApiKey = configService.get<string>('WORLDLINE_SECRET_API_KEY')?.trim();
    const environment = worldlineEnvironment(configService.get<string>('WORLDLINE_ENV', 'test'));
    this.envCredentials =
      merchantId && apiKeyId && secretApiKey
        ? { merchantId, apiKeyId, secretApiKey, environment }
        : null;
  }

  resolveCredentials(options?: PaymentGatewayCallOptions): WorldlineMerchantCredentials | null {
    const override = options?.worldlineCredentials;
    if (override?.merchantId && override.apiKeyId && override.secretApiKey) {
      return {
        merchantId: override.merchantId,
        apiKeyId: override.apiKeyId,
        secretApiKey: override.secretApiKey,
        environment: override.environment === 'live' ? 'live' : 'test',
      };
    }
    return this.envCredentials;
  }

  async authorize(
    _token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return { success: false, transactionId: '', errorMessage: 'Worldline credentials are not configured' };
    }
    const returnUrl = options?.redirect?.returnUrl || options?.redirect?.urlOk;
    if (!returnUrl) {
      return { success: false, transactionId: '', errorMessage: 'Worldline authorize requires a return URL' };
    }
    try {
      const client = this.clientFactory(creds);
      const res = await client.hostedCheckout.createHostedCheckout(
        creds.merchantId,
        {
          order: {
            amountOfMoney: {
              currencyCode: currency.toUpperCase(),
              amount: toMinorUnits(amount),
            },
          },
          cardPaymentMethodSpecificInput: { authorizationMode: 'PRE_AUTHORIZATION' },
          redirectPaymentMethodSpecificInput: { requiresApproval: true },
          hostedCheckoutSpecificInput: { returnUrl },
        },
        callContext(options),
      );
      if (!res.isSuccess || !res.body?.hostedCheckoutId) {
        return failedResult('', res.isSuccess ? undefined : res.body, 'Hosted checkout was not created');
      }
      const url = hostedCheckoutRedirectUrl(res.body);
      if (!url) {
        return {
          success: false,
          transactionId: res.body.hostedCheckoutId,
          errorMessage: 'Hosted checkout did not return a redirect URL',
        };
      }
      return {
        success: true,
        transactionId: res.body.hostedCheckoutId,
        providerStatus: 'requires_action',
        nextAction: { type: 'redirect', method: 'GET', url, formFields: {} },
      };
    } catch (err) {
      this.logger.error(`Hosted checkout create failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { success: false, transactionId: '', errorMessage: 'Hosted checkout request failed' };
    }
  }

  async capture(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return { success: false, transactionId, errorMessage: 'Worldline credentials are not configured' };
    }
    const isFinal = amount === undefined
      || options?.authorizedAmount === undefined
      || amount >= options.authorizedAmount;
    try {
      const client = this.clientFactory(creds);
      const res = await client.payments.capturePayment(
        creds.merchantId,
        transactionId,
        {
          ...(amount !== undefined ? { amount: toMinorUnits(amount) } : {}),
          isFinal,
        },
        callContext(options),
      );
      if (!res.isSuccess) return failedResult(transactionId, res.body, 'Capture failed');
      return { success: true, transactionId: res.body?.id || transactionId, providerStatus: 'succeeded' };
    } catch (err) {
      this.logger.error(`Capture failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { success: false, transactionId, errorMessage: 'Capture request failed' };
    }
  }

  async void(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return { success: false, transactionId, errorMessage: 'Worldline credentials are not configured' };
    }
    try {
      const client = this.clientFactory(creds);
      const res = await client.payments.cancelPayment(
        creds.merchantId,
        transactionId,
        {
          isFinal: true,
          ...(options?.authorizedAmount !== undefined && options.currencyCode
            ? {
                amountOfMoney: {
                  amount: toMinorUnits(options.authorizedAmount),
                  currencyCode: options.currencyCode.toUpperCase(),
                },
              }
            : {}),
        },
        callContext(options),
      );
      if (!res.isSuccess) return failedResult(transactionId, res.body, 'Void failed');
      return { success: true, transactionId, providerStatus: 'succeeded' };
    } catch (err) {
      this.logger.error(`Cancel failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { success: false, transactionId, errorMessage: 'Void request failed' };
    }
  }

  async refund(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return { success: false, transactionId, errorMessage: 'Worldline credentials are not configured' };
    }
    try {
      const client = this.clientFactory(creds);
      const res = await client.payments.refundPayment(
        creds.merchantId,
        transactionId,
        amount !== undefined && options?.currencyCode
          ? {
              amountOfMoney: {
                amount: toMinorUnits(amount),
                currencyCode: options.currencyCode.toUpperCase(),
              },
            }
          : {},
        callContext(options),
      );
      if (!res.isSuccess) return failedResult(transactionId, res.body, 'Refund failed');
      return { success: true, transactionId: res.body?.id || transactionId, providerStatus: 'succeeded' };
    } catch (err) {
      this.logger.error(`Refund failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { success: false, transactionId, errorMessage: 'Refund request failed' };
    }
  }

  /** Server read used when the guest returns. A transport error leaves the hold pending. */
  async readHostedCheckout(
    hostedCheckoutId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<{ outcome: 'authorized' | 'failed' | 'pending'; paymentId?: string; errorMessage?: string }> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return { outcome: 'pending', errorMessage: 'Worldline credentials are not configured' };
    }
    try {
      const client = this.clientFactory(creds);
      const res = await client.hostedCheckout.getHostedCheckout(creds.merchantId, hostedCheckoutId, {});
      if (!res.isSuccess || !res.body) {
        return { outcome: 'pending', errorMessage: 'Hosted checkout status is unavailable' };
      }
      const payment = res.body.createdPaymentOutput?.payment;
      return {
        outcome: classifyHostedCheckout({
          sessionStatus: res.body.status,
          paymentStatus: payment?.status,
          statusCode: payment?.statusOutput?.statusCode,
          isAuthorized: payment?.statusOutput?.isAuthorized,
          statusCategory: payment?.statusOutput?.statusCategory,
          paymentStatusCategory: res.body.createdPaymentOutput?.paymentStatusCategory,
        }),
        paymentId: payment?.id ?? undefined,
      };
    } catch (err) {
      this.logger.error(`Hosted checkout read failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { outcome: 'pending', errorMessage: 'Hosted checkout status is unavailable' };
    }
  }
}

export function worldlineEnvironment(raw: string | undefined): WorldlineEnvironment {
  return raw?.trim().toLowerCase() === 'live' ? 'live' : 'test';
}

function defaultClientFactory(creds: WorldlineMerchantCredentials): Client {
  return init({
    integrator: 'HAIP',
    host: HOSTS[creds.environment],
    scheme: 'https',
    apiKeyId: creds.apiKeyId,
    secretApiKey: creds.secretApiKey,
    enableLogging: false,
  });
}

function callContext(options?: PaymentGatewayCallOptions) {
  return options?.idempotencyKey ? { idempotence: { key: options.idempotencyKey } } : {};
}

function failedResult(
  transactionId: string,
  body: SdkErrorBody | undefined,
  fallback: string,
): PaymentGatewayResult {
  const first = body?.errors?.[0];
  return {
    success: false,
    transactionId,
    providerStatus: 'failed',
    errorMessage: first?.message || first?.errorCode || fallback,
  };
}
