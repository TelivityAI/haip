import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentGateway,
  PaymentGatewayCallOptions,
  PaymentGatewayResult,
} from '../interfaces/payment-gateway.interface';
import { createConsolePaymentGateway } from './console-payment-gateway';
import { gatewayJsonRequest, toMinorUnits, type GatewayFetchFn } from './payment-gateway-http';

interface AdyenPaymentResponse {
  pspReference?: string;
  resultCode?: string;
  refusalReason?: string;
}

/**
 * Adyen Checkout API (manual capture via Modifications API).
 *
 * Env:
 * - ADYEN_API_KEY — required for live HTTP (X-API-Key)
 * - ADYEN_MERCHANT_ACCOUNT — merchant account code
 * - ADYEN_ENV — test (default) | live
 * - ADYEN_CHECKOUT_URL — optional override (e.g. mock server)
 *
 * `token` = stored payment method id or payment method payload reference from Adyen Drop-in.
 * `transactionId` = pspReference from authorize.
 */
@Injectable()
export class AdyenGateway implements PaymentGateway {
  private readonly logger = new Logger(AdyenGateway.name);
  private readonly delegate: PaymentGateway;
  private readonly apiKey?: string;
  private readonly merchantAccount?: string;
  private readonly checkoutBase: string;
  private readonly fetchFn: GatewayFetchFn;

  constructor(
    configService: ConfigService,
    deps?: { fetchFn?: GatewayFetchFn },
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    this.apiKey = configService.get<string>('ADYEN_API_KEY');
    this.merchantAccount = configService.get<string>('ADYEN_MERCHANT_ACCOUNT');
    const env = configService.get<string>('ADYEN_ENV', 'test');
    const defaultBase =
      env === 'live'
        ? 'https://checkout-live.adyen.com/checkout/v71'
        : 'https://checkout-test.adyen.com/checkout/v71';
    this.checkoutBase = configService.get<string>('ADYEN_CHECKOUT_URL', defaultBase).replace(/\/$/, '');

    if (!this.apiKey || !this.merchantAccount) {
      this.delegate = createConsolePaymentGateway('Adyen');
    } else {
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
    return this.authorizeHttp(token, amount, currency, options);
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
      'X-API-Key': this.apiKey!,
      Accept: 'application/json',
    };
  }

  private async authorizeHttp(
    token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const body = {
      amount: { currency: currency.toUpperCase(), value: toMinorUnits(amount) },
      reference: `haip-${Date.now()}`,
      merchantAccount: this.merchantAccount,
      paymentMethod: { storedPaymentMethodId: token },
      captureDelayHours: 168,
    };

    const res = await gatewayJsonRequest<AdyenPaymentResponse>(
      `${this.checkoutBase}/payments`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    if (!res.ok || !res.data?.pspReference) {
      this.logger.error(`Adyen authorize failed: ${res.errorMessage}`);
      return {
        success: false,
        transactionId: res.data?.pspReference ?? '',
        errorMessage: res.errorMessage ?? 'Authorization failed',
      };
    }

    if (res.data.resultCode !== 'Authorised' && res.data.resultCode !== 'Received') {
      return {
        success: false,
        transactionId: res.data.pspReference,
        errorMessage: res.data.refusalReason ?? `Unexpected resultCode: ${res.data.resultCode}`,
      };
    }

    this.logger.log(`Adyen authorized: ${res.data.pspReference}`);
    return { success: true, transactionId: res.data.pspReference };
  }

  private async captureHttp(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const body: Record<string, unknown> = {
      merchantAccount: this.merchantAccount,
    };
    if (amount !== undefined) {
      body['amount'] = { value: toMinorUnits(amount) };
    }

    const res = await gatewayJsonRequest<{ pspReference?: string; status?: string }>(
      `${this.checkoutBase}/payments/${encodeURIComponent(transactionId)}/captures`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey,
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

    const id = res.data?.pspReference ?? transactionId;
    this.logger.log(`Adyen captured: ${id}`);
    return { success: true, transactionId: id };
  }

  private async voidHttp(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const res = await gatewayJsonRequest<{ pspReference?: string }>(
      `${this.checkoutBase}/payments/${encodeURIComponent(transactionId)}/cancels`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ merchantAccount: this.merchantAccount }),
        idempotencyKey: options?.idempotencyKey,
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

    const id = res.data?.pspReference ?? transactionId;
    this.logger.log(`Adyen voided: ${id}`);
    return { success: true, transactionId: id };
  }

  private async refundHttp(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const body: Record<string, unknown> = {
      merchantAccount: this.merchantAccount,
    };
    if (amount !== undefined) {
      body['amount'] = { value: toMinorUnits(amount) };
    }

    const res = await gatewayJsonRequest<{ pspReference?: string }>(
      `${this.checkoutBase}/payments/${encodeURIComponent(transactionId)}/refunds`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    if (!res.ok || !res.data?.pspReference) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? 'Refund failed',
      };
    }

    this.logger.log(`Adyen refund: ${res.data.pspReference}`);
    return { success: true, transactionId: res.data.pspReference };
  }
}
