import { Test } from '@nestjs/testing';
import { NotFoundException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingReturnController } from './booking-return.controller';
import { BookingEngineService } from './booking-engine.service';

const PROPERTY = '11111111-1111-4111-a111-111111111111';
const reference = 'a'.repeat(43);
describe('Public booking return relay HTTP boundary', () => {
  let app: INestApplication;
  const resolvePaymentReturn = vi.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BookingReturnController],
      providers: [{ provide: BookingEngineService, useValue: { resolvePaymentReturn } }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  beforeEach(() => { resolvePaymentReturn.mockReset(); });
  afterAll(async () => { await app?.close(); });

  it('redirects without browser credentials to only the persisted target and prevents caching/referrer leakage', async () => {
    const destination = `https://hotel.example/stays/book?haip_payment_return=${reference}`;
    resolvePaymentReturn.mockResolvedValue(destination);
    const response = await request(app.getHttpServer()).get(`/api/v1/booking-return/${reference}`)
      .query({ propertyId: PROPERTY, returnUrl: 'https://attacker.example', redsys: 'ok' });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(destination);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(resolvePaymentReturn).toHaveBeenCalledTimes(1);
    expect(resolvePaymentReturn).toHaveBeenCalledWith(PROPERTY, reference);
  });

  it.each([undefined, 'invalid'])('requires valid request tenant scope: %s', async (propertyId) => {
    const response = await request(app.getHttpServer()).get(`/api/v1/booking-return/${reference}`)
      .query(propertyId ? { propertyId } : {});
    expect(response.status).toBe(400);
    expect(response.headers.location).toBeUndefined();
    expect(resolvePaymentReturn).not.toHaveBeenCalled();
  });

  it('returns 404 with no redirect for unknown, expired or cross-bound capabilities', async () => {
    resolvePaymentReturn.mockRejectedValue(new NotFoundException('Payment return not found'));
    const response = await request(app.getHttpServer()).get(`/api/v1/booking-return/${reference}`)
      .query({ propertyId: PROPERTY });
    expect(response.status).toBe(404);
    expect(response.headers.location).toBeUndefined();
  });
});
