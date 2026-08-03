import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PaymentGateway,
  PaymentGatewayCallOptions,
  PaymentGatewayResult,
} from '../interfaces/payment-gateway.interface';
import { createConsolePaymentGateway } from './console-payment-gateway';

/**
 * Wise Platform payout/treasury adapter (Wave 3).
 *
 * Live Wise Platform partner APIs require partner credentials. Until a real
 * client lands, this gateway always uses the console payment delegate.
 *
 * Selector: PAYMENT_GATEWAY=wise
 */
@Injectable()
export class WiseGateway implements PaymentGateway {
  private readonly delegate: PaymentGateway;

  constructor(_configService: ConfigService) {
    this.delegate = createConsolePaymentGateway('Wise Platform');
  }

  authorize(
    token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    return this.delegate.authorize(token, amount, currency, options);
  }

  capture(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    return this.delegate.capture(transactionId, amount, options);
  }

  void(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    return this.delegate.void(transactionId, options);
  }

  refund(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult> {
    return this.delegate.refund(transactionId, amount, options);
  }
}
