import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExpediaAdapter } from './expedia.adapter';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ExpediaAdapter', () => {
  let adapter: ExpediaAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ExpediaAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string) => {
              const config: Record<string, string> = {
                EXPEDIA_BASE_URL: 'https://eqc.example.com',
                EXPEDIA_USERNAME: 'haip_test',
                EXPEDIA_PASSWORD: 'test_password',
                EXPEDIA_HOTEL_ID: 'EXP-1',
              };
              return config[key] ?? def;
            },
          },
        },
      ],
    }).compile();
    adapter = moduleRef.get(ExpediaAdapter);
  });

  it('has adapterType expedia', () => {
    expect(adapter.adapterType).toBe('expedia');
  });

  it('pushAvailability posts an EQC AR message to /eqc/ar and succeeds', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '<AvailRateUpdateRS/>' });
    const result = await adapter.pushAvailability({
      propertyId: 'p1',
      channelConnectionId: 'cc1',
      items: [{ channelRoomCode: 'EXP_STD', date: '2026-07-01', available: 5, totalInventory: 10 }],
    });
    expect(result.success).toBe(true);
    const call = mockFetch.mock.calls[0]!;
    expect(String(call[0])).toContain('/eqc/ar');
    expect(call[1].body).toContain('AvailRateUpdateRQ');
    expect(call[1].body).toContain('EXP_STD');
  });

  it('pushAvailability reports EQC <Error> responses as failures', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<AvailRateUpdateRS><Error code="123">bad room</Error></AvailRateUpdateRS>',
    });
    const result = await adapter.pushAvailability({
      propertyId: 'p1',
      channelConnectionId: 'cc1',
      items: [{ channelRoomCode: 'X', date: '2026-07-01', available: 1, totalInventory: 1 }],
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]!.message).toContain('bad room');
  });

  it('pushContent posts valid images to the Image API and rejects bad ones', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const result = await adapter.pushContent({
      propertyId: 'p1',
      channelConnectionId: 'cc1',
      property: {
        name: 'Grand',
        images: [
          { url: 'https://x/good.jpg', category: 'hero', caption: null, isPrimary: true, sortOrder: 0 },
          { url: 'ftp://x/bad.jpg', category: 'hero', caption: null, isPrimary: false, sortOrder: 1 },
        ],
      },
      roomTypes: [],
    });
    const imgCall = mockFetch.mock.calls.find((c) => String(c[0]).includes('/images'));
    expect(imgCall).toBeDefined();
    expect(imgCall![1].method).toBe('POST');
    const body = JSON.parse(imgCall![1].body as string);
    expect(body.images.map((i: any) => i.url)).toEqual(['https://x/good.jpg']);
    expect(result.errors.some((e) => e.item.startsWith('photo:'))).toBe(true);
  });

  it('pullReservations returns empty (Expedia pushes via Booking Notification)', async () => {
    const result = await adapter.pullReservations({ propertyId: 'p1', channelConnectionId: 'cc1' });
    expect(result.success).toBe(true);
    expect(result.reservations).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
