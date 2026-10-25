import { describe, it, expect } from 'vitest';
import { buildOpenApiSpec } from './openapi.js';

describe('OpenAPI schema', () => {
  const spec = buildOpenApiSpec('https://gateway.example') as any;

  it('forbids card fields on prepareBooking', () => {
    const props = spec.paths['/reservations'].post.requestBody.content['application/json'].schema.properties;
    expect(props.paymentToken).toBeUndefined();
    expect(props.cardNumber).toBeUndefined();
    expect(props.paymentMethod.enum).toEqual(['hosted_checkout', 'pay_at_property']);
    expect(props.idempotencyKey).toBeTruthy();
    expect(props.guestEmail).toBeTruthy();
  });

  it('exposes confirmPayment and paymentUrl/paymentMode', () => {
    expect(spec.paths['/reservations/{confirmationNumber}/confirm-payment'].post.operationId).toBe(
      'confirmPayment',
    );
    const resProps =
      spec.paths['/reservations'].post.responses['201'].content['application/json'].schema.properties;
    expect(resProps.paymentUrl).toBeTruthy();
    expect(resProps.paymentMode.enum).toEqual(['charge', 'authorize', 'guarantee']);
  });

  it('uses Ligare Hotels branding', () => {
    expect(String(spec.info.title)).toMatch(/Ligare/i);
  });
});
