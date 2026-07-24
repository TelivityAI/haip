import { Logger } from '@nestjs/common';
import { MockGateway } from '../mock-gateway';
import type { PaymentGateway } from '../interfaces/payment-gateway.interface';

/**
 * When PSP credentials are missing, log operations and return the same shape as
 * MockGateway so local dev and CI never require live keys.
 */
export function createConsolePaymentGateway(providerLabel: string): PaymentGateway {
  const logger = new Logger(`${providerLabel}Gateway`);
  const mock = new MockGateway();

  const wrap =
    <T extends (...args: any[]) => Promise<any>>(op: string, fn: T): T =>
    (async (...args: Parameters<T>) => {
      logger.warn(
        `[console] ${providerLabel} ${op} — PSP credentials not configured; no HTTP call`,
      );
      return fn(...args);
    }) as T;

  return {
    authorize: wrap('authorize', mock.authorize.bind(mock)),
    capture: wrap('capture', mock.capture.bind(mock)),
    void: wrap('void', mock.void.bind(mock)),
    refund: wrap('refund', mock.refund.bind(mock)),
  };
}
