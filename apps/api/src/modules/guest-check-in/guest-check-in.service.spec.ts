import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { GuestCheckInService } from './guest-check-in.service';

const PROPERTY_ID = 'a0000001-0000-4000-a000-000000000001';
const RESERVATION_ID = 'b0000001-0000-4000-b000-000000000001';
const GUEST_ID = 'c0000001-0000-4000-c000-000000000001';

function chain(result: unknown) {
  const rows = Array.isArray(result) ? result : [result];
  const thenable = {
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(thenable),
      limit: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe('GuestCheckInService', () => {
  let service: GuestCheckInService;
  let db: any;
  let payments: { authorizePayment: ReturnType<typeof vi.fn>; getClientConfig: ReturnType<typeof vi.fn>; createWorldlineTokenizationSession: ReturnType<typeof vi.fn> };
  let reservations: { preRegister: ReturnType<typeof vi.fn>; assignRoom: ReturnType<typeof vi.fn>; checkIn: ReturnType<typeof vi.fn> };
  let folios: { create: ReturnType<typeof vi.fn>; postCharge: ReturnType<typeof vi.fn> };
  let doorLock: { findByReservation: ReturnType<typeof vi.fn>; reissue: ReturnType<typeof vi.fn> };
  let storage: { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; localAbsolutePath: ReturnType<typeof vi.fn> };
  let wallet: { build: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };

  const principal = { v: 1 as const, reservationId: RESERVATION_ID, propertyId: PROPERTY_ID, exp: 9e9 };

  const BOOKING_ID = 'd0000001-0000-4000-d000-000000000001';

  const baseReservation = {
    id: RESERVATION_ID,
    propertyId: PROPERTY_ID,
    bookingId: BOOKING_ID,
    guestId: GUEST_ID,
    status: 'confirmed',
    roomId: null,
    roomTypeId: 'rt-1',
    arrivalDate: '2099-01-01',
    departureDate: '2099-01-03',
    nights: 2,
    totalAmount: '200.00',
    currencyCode: 'EUR',
    registrationSubmittedAt: null,
    registrationSignedAt: null,
    registrationData: null,
    guestIdDocument: null,
    onlineCheckInCompletedAt: null,
    checkedInAt: null,
  };

  const baseBooking = {
    id: BOOKING_ID,
    propertyId: PROPERTY_ID,
    guestId: GUEST_ID,
    confirmationNumber: 'CNF1',
  };

  const baseProperty = {
    id: PROPERTY_ID,
    name: 'Demo Hotel',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    timezone: 'UTC',
    currencyCode: 'EUR',
    guestRegistrationRequired: true,
    staffDisplayName: 'Demo',
    staffPrimaryColor: null,
    staffAccentColor: null,
    settings: {
      onlineCheckIn: {
        enabled: true,
        selfCheckInEnabled: true,
        requireIdPhoto: true,
        requirePaymentWhenBalanceDue: true,
        autoAssignRoom: true,
        accessMode: 'pin_instructions',
      },
      francePack: { enabled: true },
      upsellCampaigns: [],
    },
  };

  const baseGuest = {
    id: GUEST_ID,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+331',
    nationality: 'GB',
  };

  beforeEach(() => {
    db = {
      select: vi.fn(),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
    };
    payments = {
      authorizePayment: vi.fn(),
      getClientConfig: vi.fn().mockResolvedValue({ provider: 'mock', clientMode: 'mock' }),
      createWorldlineTokenizationSession: vi.fn(),
    };
    reservations = {
      preRegister: vi.fn().mockResolvedValue({ ...baseReservation, guestIdDocument: {} }),
      assignRoom: vi.fn(),
      checkIn: vi.fn().mockResolvedValue({}),
    };
    folios = {
      create: vi.fn().mockResolvedValue({ id: 'folio-1', status: 'open', balance: '0' }),
      postCharge: vi.fn(),
    };
    doorLock = {
      findByReservation: vi.fn().mockResolvedValue({ accessCode: '123456', provider: 'console' }),
      reissue: vi.fn(),
    };
    storage = {
      put: vi.fn().mockResolvedValue({ storageKey: `${PROPERTY_ID}/id.jpg`, url: 'local://x' }),
      get: vi.fn().mockResolvedValue(Buffer.from('img')),
      localAbsolutePath: vi.fn().mockReturnValue('/tmp/id.jpg'),
    };
    wallet = {
      build: vi.fn().mockReturnValue({
        walletEnabled: false,
        apple: { available: false, preview: {} },
        google: { available: false, preview: {} },
      }),
    };
    config = {
      get: vi.fn((key: string, def?: string) => {
        if (key === 'CHECK_IN_MAGIC_SECRET') return 'test-secret';
        if (key === 'NODE_ENV') return 'test';
        if (key === 'STRIPE_PUBLISHABLE_KEY') return null;
        if (key === 'BOOKING_APP_ORIGIN') return 'http://localhost:5174';
        if (key === 'PAYMENT_GATEWAY') return undefined;
        if (key === 'STRIPE_MODE') return def ?? 'mock';
        return def;
      }),
    };

    service = new GuestCheckInService(
      db,
      config as any,
      reservations as any,
      payments as any,
      folios as any,
      doorLock as any,
      wallet as any,
      storage as any,
      { send: vi.fn().mockResolvedValue({ status: 'sent' }) } as any,
    );
  });

  function mockLoadContext(overrides: {
    reservation?: Partial<typeof baseReservation>;
    property?: Partial<typeof baseProperty>;
    guest?: Partial<typeof baseGuest> | null;
    room?: any;
    roomType?: any;
    folios?: any[];
  } = {}) {
    const reservation = { ...baseReservation, ...overrides.reservation };
    const property = {
      ...baseProperty,
      ...overrides.property,
      settings: {
        ...baseProperty.settings,
        ...(overrides.property?.settings ?? {}),
        onlineCheckIn: {
          ...baseProperty.settings.onlineCheckIn,
          ...((overrides.property?.settings as any)?.onlineCheckIn ?? {}),
        },
      },
    };
    const guest = overrides.guest === null ? null : { ...baseGuest, ...(overrides.guest ?? {}) };
    const roomType = overrides.roomType ?? { id: 'rt-1', name: 'Deluxe' };
    const room = overrides.room ?? null;
    const folioRows = overrides.folios ?? [];

    let call = 0;
    db.select.mockImplementation(() => {
      call += 1;
      // loadContext: reservation, booking, property, guest, [room], roomType
      // getSession also: folios for balance, payments getClientConfig is separate
      if (call === 1) return chain([reservation]);
      if (call === 2) return chain([baseBooking]);
      if (call === 3) return chain([property]);
      if (call === 4) return chain(guest ? [guest] : []);
      if (reservation.roomId) {
        if (call === 5) return chain(room ? [room] : []);
        if (call === 6) return chain([roomType]);
        if (call === 7) return chain(folioRows);
        return chain([]);
      }
      if (call === 5) return chain([roomType]);
      if (call === 6) return chain(folioRows);
      // booking engine deposit / assign helpers
      return chain([]);
    });
  }

  it('gates self check-in when ID photo media id is missing', async () => {
    mockLoadContext({
      reservation: {
        status: 'assigned',
        roomId: 'room-1',
        arrivalDate: new Date().toISOString().slice(0, 10),
        registrationSubmittedAt: new Date(),
        registrationSignedAt: new Date(),
        guestIdDocument: { imageStored: false },
      },
      room: { id: 'room-1', number: '101', status: 'guest_ready' },
      folios: [],
    });
    const session = await service.getSession(principal);
    expect(session.canSelfCheckIn.allowed).toBe(false);
    expect(session.canSelfCheckIn.reason).toMatch(/ID photo/i);
  });

  it('rejects France fiche pre-register when non-FR fields are incomplete', async () => {
    mockLoadContext();
    await expect(
      service.preRegister(principal, {
        registrationSigned: true,
        registrationData: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          nationality: 'GB',
        },
        idImageBase64: `data:image/jpeg;base64,${Buffer.alloc(64, 1).toString('base64')}`,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects France fiche pre-register when nationality is empty', async () => {
    mockLoadContext({ guest: { ...baseGuest, nationality: null as any } });
    await expect(
      service.preRegister(principal, {
        registrationSigned: true,
        registrationData: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          phone: '+331',
          address: 'Paris',
          dateOfBirth: '1990-01-01',
          placeOfBirth: 'London',
        },
        idImageBase64: `data:image/jpeg;base64,${Buffer.alloc(64, 1).toString('base64')}`,
      }),
    ).rejects.toThrow(/nationality/i);
  });

  it('stores ID photo via StorageService and persists imageMediaId', async () => {
    mockLoadContext();
    reservations.preRegister.mockResolvedValue({
      ...baseReservation,
      guestIdDocument: { idType: 'passport' },
    });
    vi.spyOn(service, 'getSession').mockResolvedValue({
      steps: { id: true },
    } as any);

    const b64 = `data:image/jpeg;base64,${Buffer.alloc(64, 7).toString('base64')}`;
    await service.preRegister(principal, {
      registrationSigned: true,
      registrationData: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        nationality: 'FR',
        email: 'ada@example.com',
        phone: '+331',
        address: 'Paris',
      },
      idImageBase64: b64,
    });

    expect(storage.put).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ propertyId: PROPERTY_ID, contentType: 'image/jpeg' }),
    );
    expect(db.update).toHaveBeenCalled();
    const setFn = db.update.mock.results[0]?.value?.set;
    expect(setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        guestIdDocument: expect.objectContaining({
          imageMediaId: expect.any(String),
          imageStored: true,
        }),
      }),
    );
  });

  it('pay passes redirect URLs and returns nextAction without treating failure as success', async () => {
    const prevGateway = process.env['PAYMENT_GATEWAY'];
    process.env['PAYMENT_GATEWAY'] = 'redsys';
    config.get.mockImplementation((key: string, def?: string) => {
      if (key === 'PAYMENT_GATEWAY') return 'redsys';
      if (key === 'CHECK_IN_MAGIC_SECRET') return 'test-secret';
      if (key === 'STRIPE_MODE') return 'live';
      if (key === 'BOOKING_APP_ORIGIN') return 'http://localhost:5174';
      return def;
    });

    mockLoadContext({
      reservation: {
        registrationSubmittedAt: new Date(),
        registrationSignedAt: new Date(),
      },
      folios: [{ id: 'folio-1', status: 'open', balance: '50.00' }],
    });
    payments.authorizePayment.mockResolvedValue({
      id: 'pay-1',
      status: 'pending',
      nextAction: {
        type: 'redirect',
        method: 'POST',
        url: 'https://sis.example/pay',
        formFields: { a: 'b' },
      },
    });

    // Reload after pay for getSession
    let n = 0;
    db.select.mockImplementation(() => {
      n += 1;
      const reservation = {
        ...baseReservation,
        registrationSubmittedAt: new Date(),
        registrationSignedAt: new Date(),
      };
      // loadContext: reservation, booking, property, guest, roomType (+ folio for balance)
      if (n === 1) return chain([reservation]);
      if (n === 2) return chain([baseBooking]);
      if (n === 3) return chain([baseProperty]);
      if (n === 4) return chain([baseGuest]);
      if (n === 5) return chain([{ id: 'rt-1', name: 'Deluxe' }]);
      if (n === 6) return chain([{ id: 'folio-1', status: 'open', balance: '50.00' }]);
      // second getSession after authorize
      if (n === 7) return chain([reservation]);
      if (n === 8) return chain([baseBooking]);
      if (n === 9) return chain([baseProperty]);
      if (n === 10) return chain([baseGuest]);
      if (n === 11) return chain([{ id: 'rt-1', name: 'Deluxe' }]);
      if (n === 12) return chain([{ id: 'folio-1', status: 'open', balance: '50.00' }]);
      return chain([]);
    });

    try {
      const result = await service.pay(principal, {
        amount: 50,
        gatewayPaymentToken: 'redsys_redirect',
        gatewayProvider: 'redsys',
        returnUrl: 'https://book.example/check-in?token=abc&step=ready',
      });

      expect(payments.authorizePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrlOk: 'https://book.example/check-in?token=abc&step=ready',
          redirectUrlKo: 'https://book.example/check-in?token=abc&step=ready',
          gatewayProvider: 'redsys',
        }),
      );
      expect(result.nextAction?.url).toContain('sis.example');
    } finally {
      if (prevGateway === undefined) delete process.env['PAYMENT_GATEWAY'];
      else process.env['PAYMENT_GATEWAY'] = prevGateway;
    }
  });

  it('rejects mock gatewayProvider outside mock mode', async () => {
    const prevGateway = process.env['PAYMENT_GATEWAY'];
    process.env['PAYMENT_GATEWAY'] = 'stripe';
    config.get.mockImplementation((key: string, def?: string) => {
      if (key === 'PAYMENT_GATEWAY') return 'stripe';
      if (key === 'STRIPE_MODE') return 'live';
      return def;
    });
    mockLoadContext({
      folios: [{ id: 'folio-1', status: 'open', balance: '10.00' }],
    });
    try {
      await expect(
        service.pay(principal, {
          amount: 10,
          gatewayPaymentToken: 'tok_demo',
          gatewayProvider: 'mock',
        }),
      ).rejects.toThrow(/Mock payment gateway is not enabled/i);
    } finally {
      if (prevGateway === undefined) delete process.env['PAYMENT_GATEWAY'];
      else process.env['PAYMENT_GATEWAY'] = prevGateway;
    }
  });

  it('rejects payment amount above folio balance', async () => {
    mockLoadContext({
      folios: [{ id: 'folio-1', status: 'open', balance: '10.00' }],
    });
    await expect(
      service.pay(principal, {
        amount: 50,
        gatewayPaymentToken: 'tok_demo',
        gatewayProvider: 'mock',
      }),
    ).rejects.toThrow(/exceeds outstanding balance/i);
  });

  it('pay failure does not call getSession success path inconsistently', async () => {
    mockLoadContext({
      folios: [{ id: 'folio-1', status: 'open', balance: '10.00' }],
    });
    payments.authorizePayment.mockRejectedValue(new BadRequestException('Authorization failed: declined'));
    await expect(
      service.pay(principal, {
        amount: 10,
        gatewayPaymentToken: 'tok_bad',
        gatewayProvider: 'mock',
      }),
    ).rejects.toThrow(/Authorization failed|declined/i);
  });

  it('getAccess refuses checked_out stays and suppresses console PIN in smart_lock mode', async () => {
    mockLoadContext({
      reservation: { status: 'checked_out' },
    });
    await expect(service.getAccess(principal)).rejects.toThrow(/no longer available/i);

    mockLoadContext({
      reservation: {
        status: 'checked_in',
        roomId: 'room-1',
        checkedInAt: new Date(),
      },
      room: { id: 'room-1', number: '101', status: 'occupied' },
      property: {
        settings: {
          onlineCheckIn: { accessMode: 'smart_lock', walletEnabled: true },
        },
      },
    });
    doorLock.findByReservation.mockResolvedValue({
      accessCode: '999999',
      provider: 'console',
    });
    const access = await service.getAccess(principal);
    expect(access.accessCode).toBeNull();
    expect(access.accessUnavailableReason).toMatch(/unavailable/i);
  });

  it('findAssignableRooms excludes rooms held by overlapping assigned stays', async () => {
    const rooms = [
      { id: 'room-free', number: '102', status: 'vacant_clean' },
      { id: 'room-held', number: '101', status: 'guest_ready' },
    ];
    let call = 0;
    db.select.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rooms),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ roomId: 'room-held' }]),
        }),
      };
    });

    const found = await (service as any).findAssignableRooms(
      PROPERTY_ID,
      'rt-1',
      '2099-06-01',
      '2099-06-03',
      RESERVATION_ID,
    );
    expect(found.map((r: any) => r.id)).toEqual(['room-free']);
  });
});
