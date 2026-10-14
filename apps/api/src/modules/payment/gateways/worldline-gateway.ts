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
) => Pick<Client, 'hostedCheckout' | 'payments' | 'hostedTokenization'>;

/** Placeholder that still opens the full-page checkout. In-page card entry sends a hosted tokenization id instead. */
const HOSTED_CHECKOUT_TOKEN = 'worldline_hosted';

export interface WorldlineTokenizationSession {
  hostedTokenizationUrl: string;
  sri: string | null;
  tokenizerScriptUrl: string;
}

interface SdkErrorBody {
  errors?: Array<{ message?: string | null; errorCode?: string | null }> | null;
}

/**
 * Online Payments card hold.
 *
 * The guest enters the card in an iframe on the HAIP page. Authorize then
 * creates a PRE_AUTHORIZATION with that hosted tokenization id. A bank
 * challenge is the only full-page redirect. The `worldline_hosted` token
 * still opens hosted checkout for an in-flight session. Capture, cancel, and
 * refund use the payment id. Card numbers are never sent here. Missing
 * credentials fail closed.
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
    token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    if (!token || token === HOSTED_CHECKOUT_TOKEN) {
      return this.authorizeHostedCheckout(amount, currency, options);
    }
    return this.authorizeTokenized(token, amount, currency, options);
  }

  /** Iframe session for the card field on the HAIP page. The browser submits the card to Worldline. */
  async createTokenizationSession(
    options?: PaymentGatewayCallOptions,
  ): Promise<{ ok: true; session: WorldlineTokenizationSession } | { ok: false; errorMessage: string }> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return { ok: false, errorMessage: 'Worldline credentials are not configured' };
    }
    try {
      const client = this.clientFactory(creds);
      const res = await client.hostedTokenization.createHostedTokenization(
        creds.merchantId,
        { askConsumerConsent: false },
        {},
      );
      if (!res.isSuccess || !res.body) {
        return { ok: false, errorMessage: 'Hosted tokenization session was not created' };
      }
      const hostedTokenizationUrl = res.body.hostedTokenizationUrl?.trim();
      if (!hostedTokenizationUrl) {
        return { ok: false, errorMessage: 'Hosted tokenization session was not created' };
      }
      return {
        ok: true,
        session: {
          hostedTokenizationUrl,
          sri: res.body.sri?.trim() || null,
          tokenizerScriptUrl: worldlineTokenizerScriptUrl(creds.environment),
        },
      };
    } catch (err) {
      this.logger.error(`Tokenization session failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { ok: false, errorMessage: 'Hosted tokenization session was not created' };
    }
  }

  private async authorizeTokenized(
    hostedTokenizationId: string,
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
      const res = await client.payments.createPayment(
        creds.merchantId,
        {
          hostedTokenizationId,
          order: {
            amountOfMoney: {
              currencyCode: currency.toUpperCase(),
              amount: toMinorUnits(amount),
            },
          },
          cardPaymentMethodSpecificInput: {
            authorizationMode: 'PRE_AUTHORIZATION',
            returnUrl,
          },
        },
        callContext(options),
      );
      if (!res.isSuccess || !res.body) {
        return failedResult('', res.isSuccess ? undefined : res.body, 'Authorization failed');
      }
      return mapTokenizedPayment(res.body);
    } catch (err) {
      this.logger.error(`Tokenized authorization failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { success: false, transactionId: '', errorMessage: 'Authorization request failed' };
    }
  }

  private async authorizeHostedCheckout(
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

  /**
   * Status read for a return or webhook gap.
   * A payment id (in-page authorization, including a bank challenge) is read
   * with GetPayment. A hosted-checkout id falls through when that read is not
   * a payment. A transport error stays pending.
   */
  async readAuthorization(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<{ outcome: 'authorized' | 'failed' | 'pending'; paymentId?: string; errorMessage?: string }> {
    const creds = this.resolveCredentials(options);
    if (!creds) {
      return { outcome: 'pending', errorMessage: 'Worldline credentials are not configured' };
    }
    try {
      const client = this.clientFactory(creds);
      const res = await client.payments.getPayment(creds.merchantId, transactionId, {});
      if (res.isSuccess && res.body) {
        return classifyPaymentRead(res.body);
      }
    } catch (err) {
      this.logger.error(`Payment read failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { outcome: 'pending', errorMessage: 'Payment status is unavailable' };
    }
    return this.readHostedCheckout(transactionId, options);
  }

  /** Server read used when the guest returns from hosted checkout. A transport error leaves the hold pending. */
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
      const outcome = classifyHostedCheckout({
        sessionStatus: res.body.status,
        paymentStatus: payment?.status,
        statusCode: payment?.statusOutput?.statusCode,
        isAuthorized: payment?.statusOutput?.isAuthorized,
        statusCategory: payment?.statusOutput?.statusCategory,
        paymentStatusCategory: res.body.createdPaymentOutput?.paymentStatusCategory,
      });
      // Capture, cancel, and refund need the payment id. A hold that only has
      // the hosted checkout id is not finished yet.
      if (outcome === 'authorized' && !payment?.id) {
        return { outcome: 'pending' };
      }
      return { outcome, paymentId: payment?.id ?? undefined };
    } catch (err) {
      this.logger.error(`Hosted checkout read failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return { outcome: 'pending', errorMessage: 'Hosted checkout status is unavailable' };
    }
  }
}

export function worldlineEnvironment(raw: string | undefined): WorldlineEnvironment {
  return raw?.trim().toLowerCase() === 'live' ? 'live' : 'test';
}

export function worldlineTokenizerScriptUrl(environment: WorldlineEnvironment): string {
  return `https://${HOSTS[environment]}/hostedtokenization/js/client/tokenizer.min.js`;
}

function classifyPaymentRead(payment: {
  id?: string | null;
  status?: string | null;
  statusOutput?: {
    statusCode?: number | null;
    isAuthorized?: boolean | null;
    statusCategory?: string | null;
  } | null;
}): { outcome: 'authorized' | 'failed' | 'pending'; paymentId?: string } {
  const outcome = classifyHostedCheckout({
    paymentStatus: payment.status,
    statusCode: payment.statusOutput?.statusCode,
    isAuthorized: payment.statusOutput?.isAuthorized,
    statusCategory: payment.statusOutput?.statusCategory,
  });
  if (outcome === 'authorized' && !payment.id) return { outcome: 'pending' };
  return { outcome, paymentId: payment.id ?? undefined };
}

function mapTokenizedPayment(body: {
  payment?: {
    id?: string | null;
    status?: string | null;
    statusOutput?: {
      statusCode?: number | null;
      isAuthorized?: boolean | null;
      statusCategory?: string | null;
    } | null;
  } | null;
  merchantAction?: {
    actionType?: string | null;
    redirectData?: { redirectURL?: string | null } | null;
  } | null;
}): PaymentGatewayResult {
  const paymentId = body.payment?.id?.trim() || '';
  const redirectUrl = body.merchantAction?.redirectData?.redirectURL?.trim();
  if (body.merchantAction?.actionType?.toUpperCase() === 'REDIRECT' && redirectUrl && paymentId) {
    return {
      success: true,
      transactionId: paymentId,
      providerStatus: 'requires_action',
      nextAction: { type: 'redirect', method: 'GET', url: redirectUrl, formFields: {} },
    };
  }
  const read = classifyPaymentRead(body.payment ?? {});
  if (read.outcome === 'authorized' && paymentId) {
    return { success: true, transactionId: paymentId, providerStatus: 'succeeded' };
  }
  if (read.outcome === 'failed') {
    return {
      success: false,
      transactionId: paymentId,
      providerStatus: 'failed',
      errorMessage: 'Authorization was declined',
    };
  }
  return { success: false, transactionId: paymentId, errorMessage: 'Authorization is not complete' };
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
