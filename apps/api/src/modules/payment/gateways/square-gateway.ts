import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentGateway,
  PaymentGatewayCallOptions,
  PaymentGatewayResult,
} from '../interfaces/payment-gateway.interface';
import { createConsolePaymentGateway } from './console-payment-gateway';
import { gatewayJsonRequest, toMinorUnits, type GatewayFetchFn } from './payment-gateway-http';

interface SquarePaymentResponse {
  payment?: {
    id?: string;
    status?: string;
  };
  errors?: Array<{ detail?: string; code?: string }>;
}

interface SquareRefundResponse {
  refund?: { id?: string };
  errors?: Array<{ detail?: string }>;
}

/**
 * Square Payments API (delayed capture via autocomplete=false).
 *
 * Env:
 * - SQUARE_ACCESS_TOKEN — required for HTTP
 * - SQUARE_ENV — sandbox (default) | production
 * - SQUARE_API_BASE — optional override
 * - SQUARE_LOCATION_ID — location id for CreatePayment
 *
 * `token` = payment source id from Square Web Payments SDK (nonce).
 * `transactionId` = Square payment id.
 */
@Injectable()
export class SquareGateway implements PaymentGateway {
  private readonly logger = new Logger(SquareGateway.name);
  private readonly delegate: PaymentGateway;
  private readonly accessToken?: string;
  private readonly locationId?: string;
  private readonly apiBase: string;
  private readonly fetchFn: GatewayFetchFn;

  constructor(
    configService: ConfigService,
    deps?: { fetchFn?: GatewayFetchFn },
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    this.accessToken = configService.get<string>('SQUARE_ACCESS_TOKEN');
    this.locationId = configService.get<string>('SQUARE_LOCATION_ID');
    const env = configService.get<string>('SQUARE_ENV', 'sandbox');
    const defaultBase =
      env === 'production'
        ? 'https://connect.squareup.com/v2'
        : 'https://connect.squareupsandbox.com/v2';
    this.apiBase = configService.get<string>('SQUARE_API_BASE', defaultBase).replace(/\/$/, '');

    if (!this.accessToken || !this.locationId) {
      this.delegate = createConsolePaymentGateway('Square');
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
      Authorization: `Bearer ${this.accessToken}`,
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
      idempotency_key: options?.idempotencyKey ?? `haip-auth-${Date.now()}`,
      source_id: token,
      amount_money: { amount: toMinorUnits(amount), currency: currency.toUpperCase() },
      location_id: this.locationId,
      autocomplete: false,
    };

    const res = await gatewayJsonRequest<SquarePaymentResponse>(
      `${this.apiBase}/payments`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    const paymentId = res.data?.payment?.id;
    if (!res.ok || !paymentId) {
      const detail =
        res.data?.errors?.[0]?.detail ?? res.errorMessage ?? 'Authorization failed';
      this.logger.error(`Square authorize failed: ${detail}`);
      return { success: false, transactionId: paymentId ?? '', errorMessage: detail };
    }

    this.logger.log(`Square authorized: ${paymentId} (${res.data.payment?.status})`);
    return { success: true, transactionId: paymentId };
  }

  private async captureHttp(
    transactionId: string,
    _amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const res = await gatewayJsonRequest<SquarePaymentResponse>(
      `${this.apiBase}/payments/${encodeURIComponent(transactionId)}/complete`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          idempotency_key: options?.idempotencyKey ?? `haip-cap-${transactionId}`,
        }),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? res.data?.errors?.[0]?.detail ?? 'Capture failed',
      };
    }

    const id = res.data?.payment?.id ?? transactionId;
    this.logger.log(`Square captured: ${id}`);
    return { success: true, transactionId: id };
  }

  private async voidHttp(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const res = await gatewayJsonRequest<SquarePaymentResponse>(
      `${this.apiBase}/payments/${encodeURIComponent(transactionId)}/cancel`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          idempotency_key: options?.idempotencyKey ?? `haip-void-${transactionId}`,
        }),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? res.data?.errors?.[0]?.detail ?? 'Void failed',
      };
    }

    const id = res.data?.payment?.id ?? transactionId;
    this.logger.log(`Square voided: ${id}`);
    return { success: true, transactionId: id };
  }

  private async refundHttp(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    const body: Record<string, unknown> = {
      idempotency_key: options?.idempotencyKey ?? `haip-ref-${transactionId}`,
      payment_id: transactionId,
    };
    if (amount !== undefined) {
      body.amount_money = { amount: toMinorUnits(amount) };
    }

    const res = await gatewayJsonRequest<SquareRefundResponse>(
      `${this.apiBase}/refunds`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey,
      },
      this.fetchFn,
    );

    const refundId = res.data?.refund?.id;
    if (!res.ok || !refundId) {
      return {
        success: false,
        transactionId,
        errorMessage: res.errorMessage ?? res.data?.errors?.[0]?.detail ?? 'Refund failed',
      };
    }

    this.logger.log(`Square refund: ${refundId}`);
    return { success: true, transactionId: refundId };
  }
}
