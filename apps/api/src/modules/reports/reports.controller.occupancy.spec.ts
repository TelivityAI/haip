import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PortfolioPropertyResolver } from './portfolio-property-resolver';
import { ConfigService } from '@nestjs/config';
import { ReportQueryDto } from './dto/report-query.dto';

describe('ReportsController occupancy', () => {
  let controller: ReportsController;
  const getOccupancy = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    getOccupancy.mockResolvedValue({ date: '2026-08-09', totalRooms: 10 });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: { getOccupancy } },
        { provide: PortfolioPropertyResolver, useValue: {} },
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
    }).compile();

    controller = module.get(ReportsController);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults date to today when omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));

    await controller.getOccupancy({
      propertyId: 'a0000001-0000-4000-a000-000000000001',
    });

    expect(getOccupancy).toHaveBeenCalledWith(
      'a0000001-0000-4000-a000-000000000001',
      '2026-08-09',
    );
  });

  it('passes through an explicit date', async () => {
    await controller.getOccupancy({
      propertyId: 'a0000001-0000-4000-a000-000000000001',
      date: '2026-04-06',
    });

    expect(getOccupancy).toHaveBeenCalledWith(
      'a0000001-0000-4000-a000-000000000001',
      '2026-04-06',
    );
  });

  it('rejects invalid date via ReportQueryDto validation', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    await expect(
      pipe.transform(
        {
          propertyId: 'a0000001-0000-4000-a000-000000000001',
          date: 'not-a-date',
        },
        { type: 'query', metatype: ReportQueryDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
