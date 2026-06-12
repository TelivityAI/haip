import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SiteMinderAdapter } from './siteminder.adapter';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function soapSuccess(messageName: string, extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${messageName} xmlns="http://www.opentravel.org/OTA/2003/05">
      <Success/>${extra}
    </${messageName}>
  </soap:Body>
</soap:Envelope>`;
}

function soapFault(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>${code}</faultcode>
      <faultstring>${message}</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;
}

describe('SiteMinderAdapter', () => {
  let adapter: SiteMinderAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiteMinderAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string) => {
              const config: Record<string, string> = {
                SITEMINDER_BASE_URL: 'http://localhost:4001/pmsxchange',
                SITEMINDER_USERNAME: 'haip_test',
                SITEMINDER_PASSWORD: 'test_password',
                SITEMINDER_HOTEL_CODE: 'MOCK_SM_HOTEL',
              };
              return config[key] ?? def;
            },
          },
        },
      ],
    }).compile();

    adapter = module.get<SiteMinderAdapter>(SiteMinderAdapter);
  });

  describe('adapterType', () => {
    it('should be siteminder', () => {
      expect(adapter.adapterType).toBe('siteminder');
    });
  });

  describe('pushAvailability', () => {
    it('should send SOAP request and return success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => soapSuccess('OTA_HotelAvailNotifRS'),
      });

      const result = await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [
          { channelRoomCode: 'SGLK', date: '2026-04-15', available: 5, totalInventory: 10 },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);

      // Verify SOAP headers
      const call = mockFetch.mock.calls[0];
      expect(call[1].headers['Content-Type']).toBe('text/xml; charset=utf-8');
      expect(call[1].headers.SOAPAction).toBe('OTA_HotelAvailNotifRQ');
      expect(call[1].body).toContain('wsse:Security');
      expect(call[1].body).toContain('haip_test');
    });

    it('should return errors on OTA failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <OTA_HotelAvailNotifRS>
      <Errors><Error Code="450" ShortText="Invalid hotel"/></Errors>
    </OTA_HotelAvailNotifRS>
  </soap:Body>
</soap:Envelope>`,
      });

      const result = await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [{ channelRoomCode: 'SGLK', date: '2026-04-15', available: 5, totalInventory: 10 }],
      });

      expect(result.success).toBe(false);
      expect(result.errors[0]!.message).toContain('Invalid hotel');
    });
  });

  describe('pushRates', () => {
    it('should send rate SOAP and return success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => soapSuccess('OTA_HotelRateAmountNotifRS'),
      });

      const result = await adapter.pushRates({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [{
          channelRoomCode: 'SGLK',
          channelRateCode: 'FLEX',
          date: '2026-04-15',
          amount: 149.50,
          currencyCode: 'EUR',
        }],
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);
    });
  });

  describe('pullReservations', () => {
    it('should pull and parse reservations from SOAP response', async () => {
      const resXml = soapSuccess('OTA_ResRetrieveRS', `
      <ReservationsList>
        <HotelReservation ResStatus="Commit" CreateDateTime="2026-04-02T14:30:00Z">
          <UniqueID Type="14" ID="SM-98765432"/>
          <POS><Source><BookingChannel><CompanyName>Agoda</CompanyName></BookingChannel></Source></POS>
          <RoomStays><RoomStay>
            <RoomTypes><RoomType RoomTypeCode="SGLK"/></RoomTypes>
            <RatePlans><RatePlan RatePlanCode="FLEX"/></RatePlans>
            <GuestCounts><GuestCount AgeQualifyingCode="10" Count="1"/></GuestCounts>
            <TimeSpan Start="2026-04-20" End="2026-04-22"/>
            <Total AmountAfterTax="280.00" CurrencyCode="EUR"/>
          </RoomStay></RoomStays>
          <ResGuests><ResGuest><Profiles><ProfileInfo><Profile><Customer>
            <PersonName><GivenName>Maria</GivenName><Surname>Garcia</Surname></PersonName>
            <Email>maria@example.com</Email>
          </Customer></Profile></ProfileInfo></Profiles></ResGuest></ResGuests>
        </HotelReservation>
      </ReservationsList>`);

      mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => resXml });

      const result = await adapter.pullReservations({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
      });

      expect(result.success).toBe(true);
      expect(result.reservations).toHaveLength(1);
      expect(result.reservations[0]!.externalConfirmation).toBe('SM-98765432');
      expect(result.reservations[0]!.guestFirstName).toBe('Maria');
      expect((result.reservations[0]!.rawPayload as any).sourceChannel).toBe('Agoda');
    });

    it('should handle SOAP fault (auth failure)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => soapFault('wsse:FailedAuthentication', 'Invalid credentials'),
      });

      const result = await adapter.pullReservations({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
      });

      expect(result.success).toBe(false);
      expect(result.errors[0]!.message).toContain('Invalid credentials');
    });
  });

  describe('confirmReservation', () => {
    it('should send NotifRQ and return success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => soapSuccess('NotifRS'),
      });

      const result = await adapter.confirmReservation({
        channelConnectionId: 'cc1',
        externalConfirmation: 'SM-98765432',
        pmsConfirmationNumber: 'CH-ABC-XYZ',
      });

      expect(result.success).toBe(true);
      expect(result.itemsSynced).toBe(1);

      // Verify NotifRQ was sent
      const body = mockFetch.mock.calls[0][1].body;
      expect(body).toContain('NotifRQ');
      expect(body).toContain('SM-98765432');
      expect(body).toContain('CH-ABC-XYZ');
    });
  });

  describe('cancelReservation', () => {
    it('should return success (no-op, cancellations come via pull)', async () => {
      const result = await adapter.cancelReservation({
        channelConnectionId: 'cc1',
        externalConfirmation: 'SM-98765432',
      });

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('should return connected on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => soapSuccess('OTA_ResRetrieveRS'),
      });

      const result = await adapter.testConnection({
        hotelCode: 'SM_H1',
        username: 'u',
        password: 'p',
        baseUrl: 'http://localhost:4001/pmsxchange',
      });

      expect(result.connected).toBe(true);
      expect(result.message).toContain('SM_H1');
    });

    it('should return disconnected on SOAP fault', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => soapFault('wsse:FailedAuthentication', 'Bad creds'),
      });

      const result = await adapter.testConnection({
        hotelCode: 'SM_H1',
        username: 'wrong',
        password: 'wrong',
        baseUrl: 'http://localhost:4001/pmsxchange',
      });

      expect(result.connected).toBe(false);
      expect(result.message).toContain('Auth failed');
    });
  });

  describe('retry logic', () => {
    it('should retry on network failure', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => soapSuccess('OTA_HotelAvailNotifRS'),
        });

      const result = await adapter.pushAvailability({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [{ channelRoomCode: 'SGLK', date: '2026-04-15', available: 5, totalInventory: 10 }],
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      mockFetch.mockRejectedValue(new Error('Timeout'));

      const result = await adapter.pushRates({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        items: [{
          channelRoomCode: 'SGLK',
          channelRateCode: 'FLEX',
          date: '2026-04-15',
          amount: 100,
          currencyCode: 'EUR',
        }],
      });

      expect(result.success).toBe(false);
      expect(result.errors[0]!.message).toContain('Timeout');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('pushContent', () => {
    it('returns unsupported without any network call (pmsXchange has no content API)', async () => {
      const result = await adapter.pushContent({
        propertyId: 'p1',
        channelConnectionId: 'cc1',
        property: { name: 'Telivity Grand', images: [] },
        roomTypes: [
          {
            channelRoomCode: 'SM_DLX',
            name: 'Deluxe',
            images: [{ url: 'https://x/dlx.jpg', category: 'room', caption: null, isPrimary: true, sortOrder: 0 }],
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.itemsSynced).toBe(0);
      expect(result.errors[0]!.message).toMatch(/not supported by SiteMinder/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
