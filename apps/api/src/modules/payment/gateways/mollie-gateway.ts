import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentGateway,
  PaymentGatewayCallOptions,
  PaymentGatewayResult,
} from '../interfaces/payment-gateway.interface';
import { createConsolePaymentGateway } from './console-payment-gateway';
import { gatewayJsonRequest, toMajorAmountString, type GatewayFetchFn } from './payment-gateway-http';

interface MollieAmount {
  value: string;
  currency: string;
}

interface MolliePaymentResponse {
  id?: string;
  status?: string;
  detail?: string;
}

/**
 * Mollie Payments API (manual capture).
 *
 * Env:
 * - MOLLIE_API_KEY — required for HTTP (Bearer)
 * - MOLLIE_API_BASE — optional override (default https://api.mollie.com/v2)
 *
 * `token` = card token from Mollie Components / hosted fields.
 * `transactionId` = payment id (tr_xxx).
 */
@Injectable()
export class MollieGateway implements PaymentGateway {
  private readonly logger = new Logger(MollieGateway.name);
  private readonly delegate: PaymentGateway;
  private readonly apiKey?: string;
  private readonly apiBase: string;
  private readonly fetchFn: GatewayFetchFn;

  constructor(
    configService: ConfigService,
    deps?: { fetchFn?: GatewayFetchFn },
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    this.apiKey = configService.get<string>('MOLLIE_API_KEY');
    this.apiBase = configService
      .get<string>('MOLLIE_API_BASE', 'https://api.mollie.com/v2')
      .replace(/\/$/, '');

    if (!this.apiKey) {
      this.delegate = createConsolePaymentGateway('Mollie');
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

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
  }

  private amountValue(amount: number, currency: string): MollieAmount {
    return {
      value: toMajorAmountString(amount),
      currency: currency.toUpperCase(),
    };
  }

  private async authorizeHttp(
    token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const res = await gatewayJsonRequest<MolliePaymentResponse>(
      `${this.apiBase}/payments`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          amount: this.amountValue(amount, currency),
          description: 'HAIP authorization',
          captureMode: 'manual',
          cardToken: token,
        }),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    if (!res.ok || !res.data?.id) {
      this.logger.error(`Mollie authorize failed: ${res.errorMessage}`);
      return {
        success: false,
        transactionId: res.data?.id ?? '',
        errorMessage: res.errorMessage ?? 'Authorization failed',
      };
    }

    this.logger.log(`Mollie authorized: ${res.data.id} (${res.data.status})`);
    return { success: true, transactionId: res.data.id };
  }

  private async captureHttp(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const body: Record<string, unknown> = {};
    if (amount !== undefined) {
      body.amount = { value: toMajorAmountString(amount) };
    }

    const res = await gatewayJsonRequest<MolliePaymentResponse>(
      `${this.apiBase}/payments/${encodeURIComponent(transactionId)}/captures`,
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

    const id = res.data?.id ?? transactionId;
    this.logger.log(`Mollie captured: ${id}`);
    return { success: true, transactionId: id };
  }

  private async voidHttp(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const res = await gatewayJsonRequest<MolliePaymentResponse>(
      `${this.apiBase}/payments/${encodeURIComponent(transactionId)}/cancel`,
      {
        method: 'POST',
        headers: this.headers(),
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

    const id = res.data?.id ?? transactionId;
    this.logger.log(`Mollie voided: ${id}`);
    return { success: true, transactionId: id };
  }

  private async refundHttp(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const body: Record<string, unknown> = {};
    if (amount !== undefined) {
      body.amount = { value: toMajorAmountString(amount) };
    }

    const res = await gatewayJsonRequest<MolliePaymentResponse>(
      `${this.apiBase}/payments/${encodeURIComponent(transactionId)}/refunds`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    if (!res.ok || !res.data?.id) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? 'Refund failed',
      };
    }

    this.logger.log(`Mollie refund: ${res.data.id}`);
    return { success: true, transactionId: res.data.id };
  }
}
