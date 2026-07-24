import { ConfigService } from '@nestjs/config';
import { MockGateway } from './mock-gateway';
import {
  createPaymentGateway,
  isPaymentGatewayMockMode,
  resolvePaymentGatewayProvider,
} from './payment-gateway.factory';

function config(entries: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      entries[key] !== undefined ? entries[key] : defaultValue,
  } as ConfigService;
}

describe('payment-gateway.factory', () => {
  describe('resolvePaymentGatewayProvider', () => {
    it('defaults to mock when STRIPE_MODE=mock and PAYMENT_GATEWAY unset', () => {
      expect(
        resolvePaymentGatewayProvider(config({ STRIPE_MODE: 'mock' })),
      ).toBe('mock');
    });

    it('defaults to stripe when STRIPE_MODE=test and PAYMENT_GATEWAY unset', () => {
      expect(
        resolvePaymentGatewayProvider(config({ STRIPE_MODE: 'test' })),
      ).toBe('stripe');
    });

    it('honors explicit PAYMENT_GATEWAY', () => {
      expect(
        resolvePaymentGatewayProvider(config({ PAYMENT_GATEWAY: 'adyen', STRIPE_MODE: 'mock' })),
      ).toBe('adyen');
    });

    it('throws on unknown PAYMENT_GATEWAY', () => {
      expect(() =>
        resolvePaymentGatewayProvider(config({ PAYMENT_GATEWAY: 'unknown' })),
      ).toThrow(/Unknown PAYMENT_GATEWAY/);
    });
  });

  describe('createPaymentGateway', () => {
    it('returns MockGateway for mock mode', () => {
      const gw = createPaymentGateway(config({ STRIPE_MODE: 'mock' }));
      expect(gw).toBeInstanceOf(MockGateway);
    });
  });

  describe('isPaymentGatewayMockMode', () => {
    it('is true for PAYMENT_GATEWAY=mock', () => {
      expect(isPaymentGatewayMockMode({ PAYMENT_GATEWAY: 'mock' })).toBe(true);
    });

    it('is false when PAYMENT_GATEWAY=adyen even if STRIPE_MODE=mock', () => {
      expect(
        isPaymentGatewayMockMode({ PAYMENT_GATEWAY: 'adyen', STRIPE_MODE: 'mock' }),
      ).toBe(false);
    });
  });
});
