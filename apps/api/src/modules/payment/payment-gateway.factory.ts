import { ConfigService } from '@nestjs/config';
import { MockGateway } from './mock-gateway';
import { StripeGateway } from './stripe-gateway';
import { AdyenGateway } from './gateways/adyen-gateway';
import { MollieGateway } from './gateways/mollie-gateway';
import { SquareGateway } from './gateways/square-gateway';
import { BraintreeGateway } from './gateways/braintree-gateway';
import { WiseGateway } from './gateways/wise-gateway';
import type { PaymentGateway } from './interfaces/payment-gateway.interface';

export const PAYMENT_GATEWAY_PROVIDERS = [
  'mock',
  'stripe',
  'adyen',
  'mollie',
  'square',
  'braintree',
  'wise',
] as const;

export type PaymentGatewayProvider = (typeof PAYMENT_GATEWAY_PROVIDERS)[number];

/**
 * Resolves which PaymentGateway implementation backs PAYMENT_GATEWAY injection.
 *
 * - PAYMENT_GATEWAY selects the PSP (default: stripe when STRIPE_MODE is test/live,
 *   mock when STRIPE_MODE=mock and PAYMENT_GATEWAY is unset).
 * - STRIPE_MODE remains the legacy switch for Stripe-only deployments.
 */
export function resolvePaymentGatewayProvider(
  configService: ConfigService,
): PaymentGatewayProvider {
  const explicit = configService.get<string>('PAYMENT_GATEWAY')?.trim().toLowerCase();
  if (explicit) {
    if (!PAYMENT_GATEWAY_PROVIDERS.includes(explicit as PaymentGatewayProvider)) {
      throw new Error(
        `Unknown PAYMENT_GATEWAY '${explicit}'. Supported: ${PAYMENT_GATEWAY_PROVIDERS.join(', ')}`,
      );
    }
    return explicit as PaymentGatewayProvider;
  }

  const stripeMode = configService.get<string>('STRIPE_MODE', 'mock');
  return stripeMode === 'mock' ? 'mock' : 'stripe';
}

export function createPaymentGateway(configService: ConfigService): PaymentGateway {
  const provider = resolvePaymentGatewayProvider(configService);

  switch (provider) {
    case 'mock':
      return new MockGateway();
    case 'stripe':
      return new StripeGateway(configService);
    case 'adyen':
      return new AdyenGateway(configService);
    case 'mollie':
      return new MollieGateway(configService);
    case 'square':
      return new SquareGateway(configService);
    case 'braintree':
      return new BraintreeGateway(configService);
    case 'wise':
      return new WiseGateway(configService);
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** True when HAIP would use MockGateway / console mode for payments (boot guard). */
export function isPaymentGatewayMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env['PAYMENT_GATEWAY']?.trim().toLowerCase();
  if (explicit === 'mock') return true;
  if (explicit && explicit !== 'mock') return false;
  return (env['STRIPE_MODE'] ?? 'mock') === 'mock';
}
