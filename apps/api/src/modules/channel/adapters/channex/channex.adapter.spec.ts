import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ChannexAdapter } from './channex.adapter';

function mockConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    CHANNEX_API_KEY: 'test_channex_key',
    CHANNEX_PROPERTY_ID: 'prop-uuid-1',
    CHANNEX_BASE_URL: 'https://channex.example/api/v1',
    ...overrides,
  };
  return {
    get: (key: string, defaultValue?: string) =>
      values[key] !== undefined ? values[key] : defaultValue,
  } as ConfigService;
}

describe('ChannexAdapter', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('has adapterType channex', () => {
    const adapter = new ChannexAdapter(mockConfig(), { fetchFn: fetchMock });
    expect(adapter.adapterType).toBe('channex');
  });

  it('uses console mode when credentials are missing', async () => {
    const adapter = new ChannexAdapter(
      mockConfig({ CHANNEX_API_KEY: '', CHANNEX_PROPERTY_ID: '' }),
      { fetchFn: fetchMock },
    );
    const result = await adapter.pushAvailability({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      items: [{ channelRoomCode: 'RT1', date: '2026-04-01', available: 3, totalInventory: 5 }],
    });
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pushAvailability posts values to Channex', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const adapter = new ChannexAdapter(mockConfig(), { fetchFn: fetchMock });

    const result = await adapter.pushAvailability({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      items: [{ channelRoomCode: 'RT1', date: '2026-04-01', available: 3, totalInventory: 5 }],
    });

    expect(result.success).toBe(true);
    expect(result.itemsSynced).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://channex.example/api/v1/availability',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('user-api-key')).toBe('test_channex_key');
    const body = JSON.parse(String(init.body));
    expect(body.values[0]).toMatchObject({
      property_id: 'prop-uuid-1',
      room_type_id: 'RT1',
      availability: 3,
    });
  });

  it('pushRates posts to restrictions endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const adapter = new ChannexAdapter(mockConfig(), { fetchFn: fetchMock });

    await adapter.pushRates({
      propertyId: 'p1',
      channelConnectionId: 'c1',
      items: [
        {
          channelRoomCode: 'RT1',
          channelRateCode: 'BAR',
          date: '2026-04-01',
          amount: 120,
          currencyCode: 'EUR',
        },
      ],
    });

    expect(String(fetchMock.mock.calls[0]![0])).toContain('/restrictions');
  });

  it('pullReservations reads booking_revisions feed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'rev-1',
              attributes: {
                status: 'new',
                inserted_at: '2026-04-01T10:00:00Z',
                booking: {
                  id: 'bk-1',
                  property_id: 'prop-uuid-1',
                  arrival_date: '2026-04-10',
                  departure_date: '2026-04-12',
                  amount: '200.00',
                  currency: 'EUR',
                  customer: { name: 'Ada', surname: 'Lovelace', mail: 'ada@example.com' },
                  rooms: [
                    {
                      room_type_id: 'RT1',
                      rate_plan_id: 'BAR',
                      occupancy: { adults: 2, children: 0 },
                    },
                  ],
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const adapter = new ChannexAdapter(mockConfig(), { fetchFn: fetchMock });
    const result = await adapter.pullReservations({
      propertyId: 'p1',
      channelConnectionId: 'c1',
    });

    expect(result.success).toBe(true);
    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]!.externalConfirmation).toBe('bk-1');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('booking_revisions/feed');
  });

  it('confirmReservation acks revision', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const adapter = new ChannexAdapter(mockConfig(), { fetchFn: fetchMock });

    const result = await adapter.confirmReservation({
      channelConnectionId: 'c1',
      externalConfirmation: 'rev-99',
      pmsConfirmationNumber: 'HAIP-1',
    });

    expect(result.success).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/booking_revisions/rev-99/ack');
  });
});
