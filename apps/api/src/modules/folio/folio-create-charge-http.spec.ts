import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FiscalDocumentService } from './fiscal-document.service';
import { FolioController } from './folio.controller';
import { FolioRoutingService } from './folio-routing.service';
import { FolioService } from './folio.service';

const FOLIO = '12000000-0000-4000-a000-000000000001';
const PROPERTY = '12000000-0000-4000-a000-000000000002';
const CHARGE = '12000000-0000-4000-a000-000000000003';

describe('POST /folios/:id/charges public provenance boundary', () => {
  let app: INestApplication;
  const folioService = { postCharge: vi.fn().mockResolvedValue({ id: CHARGE }) };

  beforeEach(async () => {
    folioService.postCharge.mockClear();
    const module = await Test.createTestingModule({
      controllers: [FolioController],
      providers: [
        { provide: FolioService, useValue: folioService },
        { provide: FolioRoutingService, useValue: {} },
        { provide: FiscalDocumentService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const validCharge = () => ({
    propertyId: PROPERTY,
    type: 'room',
    description: 'Room tariff',
    amount: '100.00',
    currencyCode: 'EUR',
    serviceDate: '2026-10-01',
  });

  it.each([
    { isReversal: true },
    { originalChargeId: CHARGE },
    { adjustsChargeId: CHARGE },
    { parentChargeId: CHARGE },
    { sourceKey: 'accepted-pricing:forged' },
  ])('rejects forged internal charge provenance %j at the HTTP DTO boundary', async (forged) => {
    await request(app.getHttpServer())
      .post(`/folios/${FOLIO}/charges`)
      .send({ ...validCharge(), ...forged })
      .expect(400);

    expect(folioService.postCharge).not.toHaveBeenCalled();
  });

  it('still accepts an ordinary public charge', async () => {
    await request(app.getHttpServer())
      .post(`/folios/${FOLIO}/charges`)
      .send(validCharge())
      .expect(201);

    expect(folioService.postCharge).toHaveBeenCalledWith(
      FOLIO,
      expect.not.objectContaining({ isReversal: expect.anything() }),
    );
  });
});
