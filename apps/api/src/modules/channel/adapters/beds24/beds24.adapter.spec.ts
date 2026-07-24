import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Beds24Adapter } from './beds24.adapter';

function mockConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    BEDS24_API_KEY: 'beds_api_key',
    BEDS24_PROP_KEY: 'beds_prop_key',
    BEDS24_BASE_URL: 'https://beds24.example/json',
    ...overrides,
  };
  return {
    get: (key: string, defaultValue?: string) =>
      values[key] !== undefined ? values[key] : defaultValue,
  } as ConfigService;
}

describe('Beds24Adapter', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('has adapterType beds24', () => {
    const adapter = new Beds24Adapter(mockConfig(), { fetchFn: fetchMock });
    expect(adapter.adapterType).toBe('beds24');
  });

  it('uses console mode when credentials are missing', async () => {
    const adapter = new Beds24Adapter(
      mockConfig({ BEDS24_API_KEY: '', BEDS24_PROP_KEY: '' }),
      { fetchFn: fetchMock },
    );
    const result = await adapter.pullReservations({
      propertyId: 'p1',
      channelConnectionId: 'c1',
    });
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pushAvailability posts setRoomDates', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const adapter = new Beds24Adapter(mockConfig(), { fetchFn: fetchMock });

    const result = await adapter.pushAvailability({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      items: [{ channelRoomCode: '12345', date: '2026-04-01', available: 4, totalInventory: 10 }],
    });

    expect(result.success).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/setRoomDates');
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.authentication).toEqual({ apiKey: 'beds_api_key', propKey: 'beds_prop_key' });
    expect(body.roomId).toBe('12345');
    expect(body.dates['20260401']).toEqual({ i: '4' });
  });

  it('pushRates includes p1 price row', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const adapter = new Beds24Adapter(mockConfig(), { fetchFn: fetchMock });

    await adapter.pushRates({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      items: [
        {
          channelRoomCode: '12345',
          channelRateCode: 'BAR',
          date: '2026-04-02',
          amount: 99.5,
          currencyCode: 'USD',
        },
      ],
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.dates['20260402']).toEqual({ p1: '99.50' });
  });

  it('pullReservations posts getBookings', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            bookId: '98765',
            roomId: '12345',
            firstNight: '20260410',
            lastNight: '20260412',
            guestFirstName: 'Grace',
            guestName: 'Hopper',
            numAdult: 1,
            price: '150.00',
            status: '1',
          },
        ]),
        { status: 200 },
      ),
    );

    const adapter = new Beds24Adapter(mockConfig(), { fetchFn: fetchMock });
    const result = await adapter.pullReservations({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      since: new Date('2026-04-01T00:00:00Z'),
    });

    expect(result.success).toBe(true);
    expect(result.reservations[0]!.externalConfirmation).toBe('98765');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/getBookings');
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.modifiedSince).toBeDefined();
  });
});
