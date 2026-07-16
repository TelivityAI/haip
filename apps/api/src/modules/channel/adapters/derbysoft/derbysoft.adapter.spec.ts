import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DerbySoftAdapter } from './derbysoft.adapter';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('DerbySoftAdapter', () => {
  let adapter: DerbySoftAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DerbySoftAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string) => {
              const config: Record<string, string> = {
                DERBYSOFT_HOTEL_ID: 'MOCK_DS_HOTEL',
                DERBYSOFT_ACCOUNT_ID: 'haip_test',
                DERBYSOFT_CLIENT_SECRET: 'test_password',
                DERBYSOFT_TUNNEL_BASE_URL:
                  'http://localhost:4002/pcapigateway/tunnel/{accountId}',
                DERBYSOFT_PROFILE_BASE_URL:
                  'http://localhost:4002/pcapigateway/profile/{accountId}',
                DERBYSOFT_TOKEN_URL: 'http://localhost:4002/pcapigateway/account/token',
                // Allow localhost in tests (assertSafeChannelEndpoint)
                NODE_ENV: 'test',
                CHANNEL_ALLOW_PRIVATE_ENDPOINTS: 'true',
              };
              return config[key] ?? def;
            },
          },
        },
      ],
    }).compile();
    adapter = module.get(DerbySoftAdapter);
  });

  function mockTokenThen(...responses: ReturnType<typeof jsonResponse>[]) {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'tok123', tokenType: 'Bearer' }))
      .mockImplementation(async () => {
        const next = responses.shift();
        return next ?? jsonResponse({ header: {} });
      });
  }

  it('has adapterType derbysoft', () => {
    expect(adapter.adapterType).toBe('derbysoft');
  });

  it('pushAvailability obtains token and posts inventory', async () => {
    mockTokenThen(jsonResponse({ header: { echoToken: 'e1' } }));

    const result = await adapter.pushAvailability({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      connectionConfig: { CHANNEL_ALLOW_PRIVATE_ENDPOINTS: true },
      items: [
        { channelRoomCode: 'KING', date: '2026-04-01', available: 5, totalInventory: 10 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.itemsSynced).toBe(1);
    expect(mockFetch).toHaveBeenCalled();
    const tokenCall = mockFetch.mock.calls[0]!;
    expect(String(tokenCall[0])).toContain('/account/token');
    expect(tokenCall[1].headers.Authorization).toMatch(/^Basic /);
    const invCall = mockFetch.mock.calls[1]!;
    expect(String(invCall[0])).toContain('/inventory');
    expect(invCall[1].headers.Authorization).toBe('Bearer tok123');
    const body = JSON.parse(invCall[1].body);
    expect(body.roomId).toBe('KING');
    expect(body.type).toBe('Delta');
  });

  it('pushRates posts Overlay when configured', async () => {
    mockTokenThen(jsonResponse({ header: {} }));

    const result = await adapter.pushRates({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      connectionConfig: { ariUpdateType: 'Overlay' },
      items: [
        {
          channelRoomCode: 'KING',
          channelRateCode: 'BAR',
          date: '2026-04-01',
          amount: 100,
          currencyCode: 'USD',
        },
      ],
    });

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[1]![1].body);
    expect(body.type).toBe('Overlay');
    expect(String(mockFetch.mock.calls[1]![0])).toContain('/rate');
  });

  it('pushRestrictions posts to availability endpoint', async () => {
    mockTokenThen(jsonResponse({ header: {} }));

    const result = await adapter.pushRestrictions({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      items: [
        {
          channelRoomCode: 'KING',
          channelRateCode: 'BAR',
          date: '2026-04-01',
          stopSell: false,
          closedToArrival: true,
          closedToDeparture: false,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(String(mockFetch.mock.calls[1]![0])).toContain('/availability');
  });

  it('syncProperty posts hotel and roomtype', async () => {
    mockTokenThen(jsonResponse({ header: {} }), jsonResponse({ header: {} }));

    const result = await adapter.syncProperty({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      property: {
        name: 'Test Hotel',
        images: [],
      },
      roomTypes: [{ channelRoomCode: 'KING', name: 'King', images: [] }],
    });

    expect(result.success).toBe(true);
    expect(result.itemsSynced).toBe(2);
    expect(String(mockFetch.mock.calls[1]![0])).toContain('/hotel');
    expect(String(mockFetch.mock.calls[2]![0])).toContain('/roomtype');
  });

  it('pullReservations returns empty (push model)', async () => {
    const result = await adapter.pullReservations({
      propertyId: 'p1',
      channelConnectionId: 'c1',
    });
    expect(result.reservations).toEqual([]);
  });

  it('testConnection succeeds when token works', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ accessToken: 'tok', tokenType: 'Bearer' }));
    const result = await adapter.testConnection({});
    expect(result.connected).toBe(true);
  });

  it('confirmReservation posts resStatus', async () => {
    mockTokenThen(jsonResponse({ header: {} }));
    const result = await adapter.confirmReservation({
      channelConnectionId: 'c1',
      externalConfirmation: 'DR1',
      pmsConfirmationNumber: 'HAIP-1',
    });
    expect(result.success).toBe(true);
    expect(String(mockFetch.mock.calls[1]![0])).toContain('/resStatus');
  });
});
