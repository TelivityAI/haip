/**
 * Release smoke test — exercises migrate → seed → core PMS HTTP contract.
 *
 * Runs only when RELEASE_SMOKE=1 (CI release-smoke job). Uses AUTH_ENABLED=false
 * so the flow tests business endpoints without Keycloak setup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const runSmoke = process.env.RELEASE_SMOKE === '1';

/** Seeded demo property and entities (packages/database/src/seed.ts). */
const PROPERTY_ID = 'a0000001-0000-4000-a000-000000000001';
const GUEST_ID = 'e0000001-0000-4000-a000-000000000001';
const ROOM_TYPE_ID = 'b0000001-0000-4000-a000-000000000001';
const RATE_PLAN_ID = 'd0000001-0000-4000-a000-000000000001';
const ROOM_ID = 'c0000001-0000-4000-a000-000000000008'; // room 108 — vacant_clean

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.runIf(runSmoke)('release smoke (migrate → reservation lifecycle)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL is required for release smoke');
    }

    process.env.AUTH_ENABLED = 'false';
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_MODE = 'mock';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

    const root = join(__dirname, '..', '..', '..');
    execSync('node packages/database/dist/push-schema.js', {
      cwd: root,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });
    execSync('node packages/database/dist/seed.js', {
      cwd: root,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('search availability → create reservation → check-in → folio charge → night audit', async () => {
    const arrivalDate = offsetDate(30);
    const departureDate = offsetDate(33);

    const availRes = await request(app.getHttpServer())
      .post('/api/v1/reservations/search-availability')
      .send({
        propertyId: PROPERTY_ID,
        checkIn: arrivalDate,
        checkOut: departureDate,
        roomTypeId: ROOM_TYPE_ID,
      })
      .expect(201);

    const availability = availRes.body;
    expect(Array.isArray(availability)).toBe(true);
    expect(availability.some((r: { roomTypeId: string }) => r.roomTypeId === ROOM_TYPE_ID)).toBe(
      true,
    );

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .send({
        propertyId: PROPERTY_ID,
        guestId: GUEST_ID,
        arrivalDate,
        departureDate,
        roomTypeId: ROOM_TYPE_ID,
        ratePlanId: RATE_PLAN_ID,
        totalAmount: '599.00',
        currencyCode: 'USD',
        source: 'direct',
        adults: 2,
      })
      .expect(201);

    const reservationId = createRes.body.id as string;
    expect(reservationId).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/api/v1/reservations/${reservationId}/confirm`)
      .query({ propertyId: PROPERTY_ID })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/reservations/${reservationId}/assign-room`)
      .query({ propertyId: PROPERTY_ID })
      .send({ roomId: ROOM_ID })
      .expect(200);

    const checkInRes = await request(app.getHttpServer())
      .patch(`/api/v1/reservations/${reservationId}/check-in`)
      .query({ propertyId: PROPERTY_ID })
      .send({
        roomId: ROOM_ID,
        idType: 'passport',
        idNumber: 'SMOKE123',
        idCountry: 'US',
        registrationSigned: true,
        registrationData: {
          signatureMethod: 'front_desk',
          capturedBy: 'release-smoke',
        },
      })
      .expect(200);

    const folioId = checkInRes.body.folio?.id as string;
    expect(folioId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/api/v1/folios/${folioId}/charges`)
      .send({
        propertyId: PROPERTY_ID,
        type: 'minibar',
        description: 'Release smoke minibar charge',
        amount: '12.50',
        currencyCode: 'USD',
        serviceDate: arrivalDate,
      })
      .expect(201);

    const auditDate = offsetDate(-3);
    const auditRes = await request(app.getHttpServer())
      .post('/api/v1/night-audit/run')
      .send({ propertyId: PROPERTY_ID, businessDate: auditDate })
      .expect(200);

    expect(auditRes.body.auditRun?.status === 'completed' || auditRes.body.alreadyRun === true).toBe(
      true,
    );
  });
});
