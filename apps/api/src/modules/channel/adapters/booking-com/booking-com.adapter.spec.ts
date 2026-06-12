import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BookingComAdapter } from './booking-com.adapter';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function successXml(messageName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<${messageName} xmlns="http://www.opentravel.org/OTA/2003/05">
  <Success/>
</${messageName}>`;
}

function errorXml(messageName: string, code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<${messageName}>
  <Errors><Error Code="${code}" ShortText="${message}"/></Errors>
</${messageName}>`;
}

describe('BookingComAdapter', () => {
  let adapter: BookingComAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingComAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string) => {
              const config: Record<string, string> = {
                BOOKING_COM_BASE_URL: 'http://localhost:4000/ota',
                BOOKING_COM_USERNAME: 'haip_test',
                BOOKING_COM_PASSWORD: 'test_password',
                BOOKING_COM_HOTEL_ID: 'MOCK_HOTEL_1',
              };
              return config[key] ?? def;
            },
          },
        },
      ],
    }).compile();

    adapter = module.get<BookingComAdapter>(BookingComAdapter);
  });

  describe('adapterType', () => {
    it('should be booking_com', () => {
      expect(adapter.adapterType).toBe('booking_com');
    });
  });

  describe('pushAvailability', () => {
    it('should send OTA XML and return success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => successXml('OTA_HotelAvailNotifRS'),
      });

      const result = await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [
          { channelRoomCode: 'DLXK', date: '2026-04-15', available: 5, totalInventory: 10 },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify fetch was called with correct auth
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/ota/OTA_HotelAvailNotif',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/xml',
            Authorization: expect.stringContaining('Basic'),
          }),
        }),
      );
    });

    it('should return errors on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => errorXml('OTA_HotelAvailNotifRS', '450', 'Invalid hotel code'),
      });

      const result = await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [
          { channelRoomCode: 'DLXK', date: '2026-04-15', available: 5, totalInventory: 10 },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.itemsSynced).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toContain('Invalid hotel code');
    });
  });

  describe('pushRates', () => {
    it('should send rate data and return success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => successXml('OTA_HotelRateAmountNotifRS'),
      });

      const result = await adapter.pushRates({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [
          {
            channelRoomCode: 'DLXK',
            channelRateCode: 'BAR',
            date: '2026-04-15',
            amount: 199.99,
            currencyCode: 'USD',
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);
    });
  });

  describe('pushRestrictions', () => {
    it('should send restriction data and return success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => successXml('OTA_HotelRateAmountNotifRS'),
      });

      const result = await adapter.pushRestrictions({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [
          {
            channelRoomCode: 'DLXK',
            channelRateCode: 'BAR',
            date: '2026-04-15',
            stopSell: false,
            closedToArrival: true,
            closedToDeparture: false,
            minLos: 2,
            maxLos: 14,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);
    });
  });

  describe('pullReservations', () => {
    it('should pull and parse reservations', async () => {
      const resXml = `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelResNotifRS>
  <Success/>
  <HotelReservations>
    <HotelReservation ResStatus="Commit" CreateDateTime="2026-04-01T10:00:00Z">
      <UniqueID Type="14" ID="BDC-12345678"/>
      <RoomStays>
        <RoomStay>
          <RoomTypes><RoomType RoomTypeCode="DLXK"/></RoomTypes>
          <RatePlans><RatePlan RatePlanCode="BAR"/></RatePlans>
          <GuestCounts>
            <GuestCount AgeQualifyingCode="10" Count="2"/>
          </GuestCounts>
          <TimeSpan Start="2026-04-15" End="2026-04-18"/>
          <Total AmountAfterTax="450.00" CurrencyCode="USD"/>
        </RoomStay>
      </RoomStays>
      <ResGuests>
        <ResGuest>
          <Profiles><ProfileInfo><Profile><Customer>
            <PersonName><GivenName>Jane</GivenName><Surname>Smith</Surname></PersonName>
            <Email>jane@example.com</Email>
          </Customer></Profile></ProfileInfo></Profiles>
        </ResGuest>
      </ResGuests>
    </HotelReservation>
  </HotelReservations>
</OTA_HotelResNotifRS>`;

      mockFetch.mockResolvedValue({ ok: true, text: async () => resXml });

      const result = await adapter.pullReservations({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
      });

      expect(result.success).toBe(true);
      expect(result.reservations).toHaveLength(1);
      expect(result.reservations[0]!.externalConfirmation).toBe('BDC-12345678');
      expect(result.reservations[0]!.guestFirstName).toBe('Jane');
      expect(result.reservations[0]!.guestLastName).toBe('Smith');
      expect(result.reservations[0]!.guestEmail).toBe('jane@example.com');
    });

    it('should handle error response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => errorXml('OTA_HotelResRS', '500', 'Server error'),
      });

      const result = await adapter.pullReservations({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
      });

      expect(result.success).toBe(false);
      expect(result.reservations).toHaveLength(0);
    });
  });

  describe('cancelReservation', () => {
    it('should send cancellation and return success', async () => {
      const cancelRsXml = `<?xml version="1.0" encoding="UTF-8"?>
<OTA_CancelRS Status="Cancelled">
  <Success/>
</OTA_CancelRS>`;

      mockFetch.mockResolvedValue({ ok: true, text: async () => cancelRsXml });

      const result = await adapter.cancelReservation({
        channelConnectionId: 'cc1',
        externalConfirmation: 'BDC-12345678',
        reason: 'Guest requested cancellation',
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);
    });
  });

  describe('testConnection', () => {
    it('should return connected on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => successXml('OTA_HotelAvailNotifRS'),
      });

      const result = await adapter.testConnection({
        hotelId: 'HOTEL1',
        username: 'test',
        password: 'pass',
        baseUrl: 'http://localhost:4000/ota',
      });

      expect(result.connected).toBe(true);
      expect(result.message).toContain('HOTEL1');
    });

    it('should return disconnected on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await adapter.testConnection({
        hotelId: 'HOTEL1',
        username: 'test',
        password: 'pass',
        baseUrl: 'http://localhost:4000/ota',
      });

      expect(result.connected).toBe(false);
      expect(result.message).toContain('ECONNREFUSED');
    });
  });

  describe('retry logic', () => {
    it('should retry on HTTP failure', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => successXml('OTA_HotelAvailNotifRS'),
        });

      const result = await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [{ channelRoomCode: 'DLXK', date: '2026-04-15', available: 5, totalInventory: 10 }],
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [{ channelRoomCode: 'DLXK', date: '2026-04-15', available: 5, totalInventory: 10 }],
      });

      expect(result.success).toBe(false);
      expect(result.errors[0]!.message).toContain('Network error');
      expect(mockFetch).toHaveBeenCalledTimes(3); // default maxRetries
    });
  });

  describe('Basic Auth', () => {
    it('should send correct Basic Auth header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => successXml('OTA_HotelAvailNotifRS'),
      });

      await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [{ channelRoomCode: 'DLXK', date: '2026-04-15', available: 5, totalInventory: 10 }],
      });

      const expectedAuth = Buffer.from('haip_test:test_password').toString('base64');
      const call = mockFetch.mock.calls[0];
      expect(call[1].headers.Authorization).toBe(`Basic ${expectedAuth}`);
    });
  });

  describe('pushContent', () => {
    it('submits photos as JSON to the pending-photos endpoint (not OTA XML)', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => '{}' });

      const result = await adapter.pushContent({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        property: {
          name: 'Telivity Grand',
          description: 'Oceanfront',
          starRating: 5,
          images: [{ url: 'https://x/hero.jpg', category: 'hero', caption: 'H', isPrimary: true, sortOrder: 0 }],
        },
        roomTypes: [
          {
            channelRoomCode: 'SGL_KING',
            name: 'Standard King',
            maxOccupancy: 2,
            images: [{ url: 'https://x/std.jpg', category: 'room', caption: null, isPrimary: true, sortOrder: 0 }],
          },
        ],
      });

      expect(result.success).toBe(true);
      const photoCall = mockFetch.mock.calls.find((c) => String(c[0]).includes('/pending/photos'));
      expect(photoCall).toBeDefined();
      expect(photoCall![1].method).toBe('POST');
      expect(photoCall![1].headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(photoCall![1].body as string);
      expect(body.photos.map((p: any) => p.url)).toContain('https://x/std.jpg');
    });

    it('rejects non-jpeg/png images and reports them as errors', async () => {
      mockFetch.mockResolvedValue({ ok: true, text: async () => '{}' });
      const result = await adapter.pushContent({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        property: { name: 'X', images: [{ url: 'https://x/bad.gif', category: 'hero', caption: null, isPrimary: true, sortOrder: 0 }] },
        roomTypes: [],
      });
      expect(result.errors.some((e) => e.item.startsWith('photo:'))).toBe(true);
    });
  });
});
