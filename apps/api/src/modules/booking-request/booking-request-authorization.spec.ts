import {
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { BookingEngineAdminController } from '../booking-engine/booking-engine-admin.controller';
import { BookingEngineConfigService } from '../booking-engine/booking-engine-config.service';
import { BookingRequestMailerService } from './booking-request-mailer.service';
import { BookingRequestPaymentService } from './booking-request-payment.service';
import { BookingRequestController } from './booking-request.controller';
import { BookingRequestService } from './booking-request.service';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PREVIEW_TOKEN = `v1:${'a'.repeat(64)}`;

const grants: Record<string, string[]> = {
  reader: ['reservations.read'],
  writer: ['reservations.write'],
  config: ['bookingengine.manage'],
  none: [],
};

@Injectable()
class AuthenticatedTestPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: { sub: string; email: string };
    }>();
    const header = req.headers['x-test-user'];
    const sub = Array.isArray(header) ? header[0] : header;
    if (sub) req.user = { sub, email: `${sub}@example.com` };
    return true;
  }
}

describe('Booking Request staff authorization contract', () => {
  let app: INestApplication;
  const bookingRequests = {
    list: vi.fn(async () => ({ data: [], page: 1, limit: 20, total: 0 })),
    findById: vi.fn(async () => ({ id: REQUEST_ID, propertyId: PROPERTY_ID })),
    accept: vi.fn(async () => ({
      requestId: REQUEST_ID,
      status: 'accepted',
      reservationId: '33333333-3333-4333-8333-333333333333',
    })),
  };
  const bookingEngineConfig = {
    getConfig: vi.fn(async () => ({
      propertyId: PROPERTY_ID,
      bookingMode: 'request',
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BookingRequestController, BookingEngineAdminController],
      providers: [
        { provide: APP_GUARD, useClass: AuthenticatedTestPrincipalGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: ConfigService, useValue: { get: () => 'true' } },
        {
          provide: PermissionsService,
          useValue: {
            findLocalUser: async (sub?: string) => sub ? { id: sub } : null,
            getEffectivePermissions: async (userId: string) => grants[userId] ?? [],
          },
        },
        { provide: BookingRequestService, useValue: bookingRequests },
        { provide: BookingRequestPaymentService, useValue: {} },
        { provide: BookingRequestMailerService, useValue: {} },
        { provide: BookingEngineConfigService, useValue: bookingEngineConfig },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires reservations.read for the staff queue and detail surface', async () => {
    const http = request(app.getHttpServer());
    await http
      .get('/api/v1/booking-requests')
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'none')
      .expect(403);
    await http
      .get('/api/v1/booking-requests')
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'reader')
      .expect(200);
    await http
      .get(`/api/v1/booking-requests/${REQUEST_ID}`)
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'none')
      .expect(403);
    await http
      .get(`/api/v1/booking-requests/${REQUEST_ID}`)
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'reader')
      .expect(200);
    expect(bookingRequests.list).toHaveBeenCalledOnce();
    expect(bookingRequests.findById).toHaveBeenCalledOnce();
  });

  it('requires reservations.write for acceptance even when read is granted', async () => {
    const http = request(app.getHttpServer());
    const body = { priceSource: 'current', previewToken: PREVIEW_TOKEN };
    await http
      .post(`/api/v1/booking-requests/${REQUEST_ID}/accept`)
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'reader')
      .send(body)
      .expect(403);
    await http
      .post(`/api/v1/booking-requests/${REQUEST_ID}/accept`)
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'writer')
      .send(body)
      .expect(201);
    expect(bookingRequests.accept).toHaveBeenCalledOnce();
  });

  it('requires bookingengine.manage for booking engine configuration', async () => {
    const http = request(app.getHttpServer());
    await http
      .get('/api/v1/admin/booking-engine/config')
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'writer')
      .expect(403);
    await http
      .get('/api/v1/admin/booking-engine/config')
      .query({ propertyId: PROPERTY_ID })
      .set('x-test-user', 'config')
      .expect(200);
    expect(bookingEngineConfig.getConfig).toHaveBeenCalledOnce();
  });
});
