import { isPaymentGatewayMockMode } from '../../modules/payment/payment-gateway.factory';

/**
 * Refuse to boot an insecure configuration in production. The #1 real-world
 * breach risk is shipping with AUTH_ENABLED=false (or payment gateways in mock
 * mode) to a production host. The intentional public demo opts out with
 * HAIP_ALLOW_INSECURE=true.
 *
 * Pure function over an env map so it's unit-testable; main.ts calls it with
 * process.env at startup.
 */
export function assertSecureConfig(env: NodeJS.ProcessEnv = process.env): void {
  // Enforce for any production-like environment, not just NODE_ENV=production —
  // a host run as 'staging' must not silently boot with auth off either. Local
  // dev/test ('development', 'test', or unset) stays permissive.
  const nodeEnv = env['NODE_ENV'];
  const productionLike = nodeEnv === 'production' || nodeEnv === 'staging';
  if (!productionLike) return;
  if (env['HAIP_ALLOW_INSECURE'] === 'true') return;
  const problems: string[] = [];
  if (env['AUTH_ENABLED'] === 'false') problems.push('AUTH_ENABLED=false');
  if (isPaymentGatewayMockMode(env)) {
    problems.push('PAYMENT_GATEWAY=mock (or STRIPE_MODE=mock when PAYMENT_GATEWAY unset)');
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure config: ${problems.join(', ')}. ` +
        'Set real values, or set HAIP_ALLOW_INSECURE=true to override (e.g. for the public demo).',
    );
  }
}
