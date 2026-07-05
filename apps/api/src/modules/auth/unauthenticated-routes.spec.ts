import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, raw } from 'express';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { securityHeaders } from '../../common/http/security-headers';

/**
 * Module root paths must be registered so JwtAuthGuard runs before Nest returns
 * 404 for unknown routes. Financial modules use dashboard nav keys (/cashier,
 * /accounting, /reports) that must reject unauthenticated callers with 401.
 */
describe('Unauthenticated access to financial module routes', () => {
  let app: INestApplication;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [
      'NODE_ENV',
      'AUTH_ENABLED',
      'HAIP_ALLOW_INSECURE',
      'SERVE_DASHBOARD',
      'SERVE_BOOKING',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_ENABLED'] = 'true';
    process.env['HAIP_ALLOW_INSECURE'] = 'true';
    process.env['SERVE_DASHBOARD'] = 'false';
    process.env['SERVE_BOOKING'] = 'false';

    app = await NestFactory.create(AppModule, { logger: false });
    app.use(securityHeaders());
    app.use('/api/v1/webhooks/stripe', raw({ type: 'application/json' }));
    app.use(json());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, prev] of Object.entries(savedEnv)) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  const protectedGets = [
    '/api/v1/cashier',
    '/api/v1/cashier/drawers/aaaaaaaa-0000-4000-a000-000000000001',
    '/api/v1/accounting',
    '/api/v1/accounting/codes',
    '/api/v1/reports',
    '/api/v1/reports/daily-revenue',
    '/api/v1/deposits',
  ];

  for (const path of protectedGets) {
    it(`GET ${path} without Authorization returns 401`, async () => {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(401);
    });
  }
});
