import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentGateway,
  PaymentGatewayCallOptions,
  PaymentGatewayResult,
} from '../interfaces/payment-gateway.interface';
import { createConsolePaymentGateway } from './console-payment-gateway';
import { gatewayJsonRequest, toMajorAmountString, type GatewayFetchFn } from './payment-gateway-http';

interface BraintreeTransactionResponse {
  transaction?: {
    id?: string;
    status?: string;
  };
  message?: string;
  apiErrorResponse?: { message?: string };
}

/**
 * Braintree transaction API (authorize → submit for settlement → void/refund).
 *
 * Env:
 * - BRAINTREE_MERCHANT_ID
 * - BRAINTREE_PUBLIC_KEY
 * - BRAINTREE_PRIVATE_KEY
 * - BRAINTREE_ENV — sandbox (default) | production
 * - BRAINTREE_API_BASE — optional override
 *
 * `token` = payment method nonce or vaulted token from Braintree client SDK.
 * `transactionId` = Braintree transaction id.
 */
@Injectable()
export class BraintreeGateway implements PaymentGateway {
  private readonly logger = new Logger(BraintreeGateway.name);
  private readonly delegate: PaymentGateway;
  private readonly merchantId?: string;
  private readonly authHeader?: string;
  private readonly apiBase: string;
  private readonly fetchFn: GatewayFetchFn;

  constructor(
    configService: ConfigService,
    deps?: { fetchFn?: GatewayFetchFn },
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    const merchantId = configService.get<string>('BRAINTREE_MERCHANT_ID');
    const publicKey = configService.get<string>('BRAINTREE_PUBLIC_KEY');
    const privateKey = configService.get<string>('BRAINTREE_PRIVATE_KEY');
    this.merchantId = merchantId;

    const env = configService.get<string>('BRAINTREE_ENV', 'sandbox');
    const defaultBase =
      env === 'production'
        ? 'https://api.braintreegateway.com'
        : 'https://api.sandbox.braintreegateway.com';
    this.apiBase = configService.get<string>('BRAINTREE_API_BASE', defaultBase).replace(/\/$/, '');

    if (!merchantId || !publicKey || !privateKey) {
      this.delegate = createConsolePaymentGateway('Braintree');
    } else {
      this.authHeader = `Basic ${Buffer.from(`${publicKey}:${privateKey}`).toString('base64')}`;
      this.delegate = this;
    }
  }

  authorize(
    token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    if (this.delegate !== this) {
      return this.delegate.authorize(token, amount, currency, options);
    }
    return this.authorizeHttp(token, amount, options);
  }

  capture(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    if (this.delegate !== this) {
      return this.delegate.capture(transactionId, amount, options);
    }
    return this.captureHttp(transactionId, amount, options);
  }

  void(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    if (this.delegate !== this) {
      return this.delegate.void(transactionId, options);
    }
    return this.voidHttp(transactionId, options);
  }

  refund(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    if (this.delegate !== this) {
      return this.delegate.refund(transactionId, amount, options);
    }
    return this.refundHttp(transactionId, amount, options);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader!,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Braintree-Version': '2018-09-10',
    };
  }

  private txUrl(transactionId: string, action?: string): string {
    const base = `${this.apiBase}/merchants/${encodeURIComponent(this.merchantId!)}/transactions/${encodeURIComponent(transactionId)}`;
    return action ? `${base}/${action}` : base;
  }

  private async authorizeHttp(
    token: string,
    amount: number,
    _options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const res = await gatewayJsonRequest<BraintreeTransactionResponse>(
      `${this.apiBase}/merchants/${encodeURIComponent(this.merchantId!)}/transactions`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          transaction: {
            amount: toMajorAmountString(amount),
            paymentMethodNonce: token,
            options: { submitForSettlement: false },
          },
        }),
      },
      this.fetchFn,
    );

    const id = res.data?.transaction?.id;
    if (!res.ok || !id) {
      const message =
        res.data?.message ??
        res.data?.apiErrorResponse?.message ??
        res.errorMessage ??
        'Authorization failed';
      this.logger.error(`Braintree authorize failed: ${message}`);
      return { success: false, transactionId: id ?? '', errorMessage: message };
    }

    this.logger.log(`Braintree authorized: ${id} (${res.data?.transaction?.status})`);
    return { success: true, transactionId: id };
  }

  private async captureHttp(
    transactionId: string,
    amount?: number,
    _options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const body =
      amount !== undefined
        ? { transaction: { amount: toMajorAmountString(amount) } }
        : undefined;

    const res = await gatewayJsonRequest<BraintreeTransactionResponse>(
      this.txUrl(transactionId, 'submit_for_settlement'),
      {
        method: 'PUT',
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? 'Capture failed',
      };
    }

    const id = res.data?.transaction?.id ?? transactionId;
    this.logger.log(`Braintree captured: ${id}`);
    return { success: true, transactionId: id };
  }

  private async voidHttp(
    transactionId: string,
    _options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const res = await gatewayJsonRequest<BraintreeTransactionResponse>(
      this.txUrl(transactionId, 'void'),
      {
        method: 'PUT',
        headers: this.headers(),
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? 'Void failed',
      };
    }

    const id = res.data?.transaction?.id ?? transactionId;
    this.logger.log(`Braintree voided: ${id}`);
    return { success: true, transactionId: id };
  }

  private async refundHttp(
    transactionId: string,
    amount?: number,
    _options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const transaction: Record<string, unknown> = {};
    if (amount !== undefined) {
      transaction['amount'] = toMajorAmountString(amount);
    }
    const body: Record<string, unknown> = { transaction };

    const res = await gatewayJsonRequest<BraintreeTransactionResponse>(
      this.txUrl(transactionId, 'refund'),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      this.fetchFn,
    );

    const id = res.data?.transaction?.id;
    if (!res.ok || !id) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? 'Refund failed',
      };
    }

    this.logger.log(`Braintree refund: ${id}`);
    return { success: true, transactionId: id };
  }
}
