import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import {
  folios,
  guests,
  properties,
  reservations,
  roomTypes,
  rooms,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { ReservationService } from '../reservation/reservation.service';
import { PaymentService } from '../payment/payment.service';
import { FolioService } from '../folio/folio.service';
import { DoorLockService } from '../door-lock/door-lock.service';
import {
  defaultTokenTtlSeconds,
  signCheckInToken,
} from './check-in-token';
import { WalletPassService } from './wallet-pass.service';
import type {
  GuestAcceptUpsellDto,
  GuestPayDto,
  GuestPreRegisterDto,
} from './dto/guest-check-in.dto';
import type { CheckInPrincipal } from './check-in-magic.guard';

interface OnlineCheckInSettings {
  enabled?: boolean;
  selfCheckInEnabled?: boolean;
  checkInStartTime?: string;
  autoAssignRoom?: boolean;
  requireIdPhoto?: boolean;
  requirePaymentWhenBalanceDue?: boolean;
  accessMode?: 'smart_lock' | 'pin_instructions' | 'unconfigured';
  accessInstructions?: string;
  walletEnabled?: boolean;
  lockProvider?: string;
  checkInAppOrigin?: string;
}

interface UpsellCampaign {
  id: string;
  name: string;
  enabled?: boolean;
  type: 'room_upgrade' | 'addon';
  targetRoomTypeId?: string;
  priceDelta?: number;
  currencyCode?: string;
  description?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class GuestCheckInService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly config: ConfigService,
    private readonly reservations: ReservationService,
    private readonly payments: PaymentService,
    private readonly folios: FolioService,
    private readonly doorLock: DoorLockService,
    private readonly wallet: WalletPassService,
  ) {}

  private magicSecret(): string {
    return (
      this.config.get<string>('CHECK_IN_MAGIC_SECRET') ||
      this.config.get<string>('JWT_SECRET') ||
      this.config.get<string>('SESSION_SECRET') ||
      'dev-check-in-secret-change-me'
    );
  }

  async issueLinkForReservation(
    propertyId: string,
    reservationId: string,
    ttlSeconds?: number,
  ) {
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));
    if (!property) throw new NotFoundException('Property not found');

    const ttl = ttlSeconds ?? defaultTokenTtlSeconds();
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const token = signCheckInToken(
      { v: 1, reservationId, propertyId, exp },
      this.magicSecret(),
    );

    const settings = (property.settings ?? {}) as {
      onlineCheckIn?: OnlineCheckInSettings;
    };
    const origin = (
      settings.onlineCheckIn?.checkInAppOrigin ||
      this.config.get<string>('BOOKING_APP_ORIGIN') ||
      'http://localhost:5174'
    ).replace(/\/$/, '');

    return {
      token,
      url: `${origin}/check-in?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  private async loadContext(principal: CheckInPrincipal) {
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, principal.reservationId),
          eq(reservations.propertyId, principal.propertyId),
        ),
      );
    if (!reservation) throw new NotFoundException('Reservation not found');

    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, principal.propertyId));
    if (!property) throw new NotFoundException('Property not found');

    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, reservation.guestId));

    let room: typeof rooms.$inferSelect | null = null;
    if (reservation.roomId) {
      const [r] = await this.db
        .select()
        .from(rooms)
        .where(
          and(eq(rooms.id, reservation.roomId), eq(rooms.propertyId, principal.propertyId)),
        );
      room = r ?? null;
    }

    const [roomType] = await this.db
      .select()
      .from(roomTypes)
      .where(
        and(
          eq(roomTypes.id, reservation.roomTypeId),
          eq(roomTypes.propertyId, principal.propertyId),
        ),
      );

    const settings = (property.settings ?? {}) as {
      onlineCheckIn?: OnlineCheckInSettings;
      upsellCampaigns?: UpsellCampaign[];
    };
    const online: OnlineCheckInSettings = { ...(settings.onlineCheckIn ?? {}) };

    return { reservation, property, guest, room, roomType, online, settings };
  }

  async getSession(principal: CheckInPrincipal) {
    const ctx = await this.loadContext(principal);
    const online = ctx.online;
    const configFlags = {
      enabled: online.enabled !== false,
      selfCheckInEnabled: online.selfCheckInEnabled !== false,
      checkInStartTime: online.checkInStartTime || ctx.property.checkInTime,
      autoAssignRoom: online.autoAssignRoom !== false,
      requireIdPhoto: online.requireIdPhoto !== false,
      requirePaymentWhenBalanceDue: online.requirePaymentWhenBalanceDue !== false,
      accessMode: online.accessMode ?? 'unconfigured',
      accessInstructions: online.accessInstructions ?? null,
      walletEnabled: online.walletEnabled !== false,
    };
    if (!configFlags.enabled) {
      throw new BadRequestException('Online check-in is disabled for this property');
    }

    const folioBalance = await this.folioBalanceForReservation(
      ctx.reservation.id,
      principal.propertyId,
    );

    const registrationComplete = Boolean(
      ctx.reservation.registrationSubmittedAt && ctx.reservation.registrationSignedAt,
    );
    const roomReady =
      ctx.reservation.status === 'assigned' &&
      ctx.room &&
      ['guest_ready', 'vacant_clean'].includes(ctx.room.status);

    const canSelfCheckIn = this.evaluateSelfCheckIn(ctx, registrationComplete, folioBalance);

    return {
      property: {
        id: ctx.property.id,
        name: ctx.property.name,
        checkInTime: ctx.property.checkInTime,
        checkOutTime: ctx.property.checkOutTime,
        timezone: ctx.property.timezone,
        currencyCode: ctx.property.currencyCode,
        guestRegistrationRequired: ctx.property.guestRegistrationRequired,
        branding: {
          // Guest branding comes from booking engine in the UI; expose basics here.
          displayName: ctx.property.staffDisplayName || ctx.property.name,
          primaryColor: ctx.property.staffPrimaryColor,
          accentColor: ctx.property.staffAccentColor,
        },
      },
      reservation: {
        id: ctx.reservation.id,
        confirmationNumber: ctx.reservation.confirmationNumber,
        status: ctx.reservation.status,
        arrivalDate: ctx.reservation.arrivalDate,
        departureDate: ctx.reservation.departureDate,
        nights: ctx.reservation.nights,
        totalAmount: ctx.reservation.totalAmount,
        currencyCode: ctx.reservation.currencyCode,
        roomTypeId: ctx.reservation.roomTypeId,
        roomTypeName: ctx.roomType?.name ?? null,
        roomId: ctx.reservation.roomId,
        roomNumber: ctx.room?.number ?? null,
        registrationSubmittedAt: ctx.reservation.registrationSubmittedAt,
        registrationSignedAt: ctx.reservation.registrationSignedAt,
        registrationData: ctx.reservation.registrationData ?? null,
        onlineCheckInCompletedAt: ctx.reservation.onlineCheckInCompletedAt ?? null,
        hasIdDocument: Boolean(ctx.reservation.guestIdDocument),
      },
      guest: ctx.guest
        ? {
            firstName: ctx.guest.firstName,
            lastName: ctx.guest.lastName,
            email: ctx.guest.email,
            phone: ctx.guest.phone,
            nationality: ctx.guest.nationality,
          }
        : null,
      config: configFlags,
      folioBalance,
      registrationComplete,
      roomReady:
        Boolean(roomReady) ||
        (ctx.reservation.status === 'confirmed' && configFlags.autoAssignRoom),
      canSelfCheckIn,
      steps: {
        registration: registrationComplete,
        id: Boolean(ctx.reservation.guestIdDocument),
        payment: folioBalance <= 0.009 || !configFlags.requirePaymentWhenBalanceDue,
        checkedIn: ['checked_in', 'stayover', 'due_out'].includes(ctx.reservation.status),
      },
    };
  }

  private evaluateSelfCheckIn(
    ctx: Awaited<ReturnType<GuestCheckInService['loadContext']>>,
    registrationComplete: boolean,
    folioBalance: number,
  ): { allowed: boolean; reason?: string } {
    if (ctx.online.selfCheckInEnabled === false) {
      return { allowed: false, reason: 'Self check-in is disabled' };
    }
    if (['checked_in', 'stayover', 'due_out'].includes(ctx.reservation.status)) {
      return { allowed: false, reason: 'Already checked in' };
    }
    if (!['confirmed', 'assigned'].includes(ctx.reservation.status)) {
      return { allowed: false, reason: `Cannot check in from status ${ctx.reservation.status}` };
    }
    if (ctx.property.guestRegistrationRequired && !registrationComplete) {
      return { allowed: false, reason: 'Complete registration first' };
    }
    if (ctx.online.requireIdPhoto !== false) {
      const doc = ctx.reservation.guestIdDocument as Record<string, unknown> | null;
      if (!doc || (!doc['imageMediaId'] && !doc['imageStored'])) {
        return { allowed: false, reason: 'ID photo required' };
      }
    }
    if (
      ctx.online.requirePaymentWhenBalanceDue !== false &&
      folioBalance > 0.009
    ) {
      return { allowed: false, reason: 'Outstanding balance must be paid' };
    }

    const accessMode = ctx.online.accessMode ?? 'unconfigured';
    if (accessMode === 'unconfigured') {
      return { allowed: false, reason: 'Property has not configured room access yet' };
    }

    const start = ctx.online.checkInStartTime || ctx.property.checkInTime || '15:00';
    const arrival = String(ctx.reservation.arrivalDate);
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: ctx.property.timezone || 'UTC',
    });
    if (arrival > today) {
      return { allowed: false, reason: 'Check-in opens on arrival day' };
    }
    if (arrival === today) {
      const [h, m] = start.split(':').map(Number);
      const nowLocal = new Date(
        new Date().toLocaleString('en-US', { timeZone: ctx.property.timezone || 'UTC' }),
      );
      if (
        nowLocal.getHours() < (h ?? 15) ||
        (nowLocal.getHours() === (h ?? 15) && nowLocal.getMinutes() < (m ?? 0))
      ) {
        return { allowed: false, reason: `Check-in opens at ${start}` };
      }
    }

    if (ctx.reservation.status === 'assigned') {
      if (
        ctx.room &&
        !['guest_ready', 'vacant_clean'].includes(ctx.room.status)
      ) {
        return { allowed: false, reason: 'Room is not ready yet' };
      }
    } else if (ctx.online.autoAssignRoom === false) {
      return { allowed: false, reason: 'Waiting for room assignment' };
    }

    return { allowed: true };
  }

  private async folioBalanceForReservation(
    reservationId: string,
    propertyId: string,
  ): Promise<number> {
    const rows = await this.db
      .select()
      .from(folios)
      .where(
        and(
          eq(folios.reservationId, reservationId),
          eq(folios.propertyId, propertyId),
          inArray(folios.status, ['open', 'settled']),
        ),
      );
    if (!rows.length) return 0;
    return rows.reduce((sum: number, f: any) => sum + Number(f.balance ?? 0), 0);
  }

  async preRegister(principal: CheckInPrincipal, dto: GuestPreRegisterDto) {
    const ctx = await this.loadContext(principal);
    if (ctx.online.enabled === false) {
      throw new BadRequestException('Online check-in is disabled for this property');
    }

    const registrationData = {
      ...(dto.registrationData ?? {}),
      ...(dto.idImageBase64
        ? {
            idPhotoCapturedAt: new Date().toISOString(),
            idPhotoPresent: true,
          }
        : {}),
    };

    const updated = await this.reservations.preRegister(
      principal.reservationId,
      principal.propertyId,
      {
        registrationSigned: dto.registrationSigned ?? true,
        registrationData,
        idType: dto.idType,
        idNumber: dto.idNumber,
        idCountry: dto.idCountry,
        idExpiry: dto.idExpiry,
      },
    );

    if (dto.idImageBase64) {
      // Persist a compact flag on the encrypted document blob (photo bytes stay
      // out of the row — store a truncated fingerprint only for "has photo").
      const existing = (updated.guestIdDocument ?? {}) as Record<string, unknown>;
      const imageStored = true;
      await this.db
        .update(reservations)
        .set({
          guestIdDocument: {
            ...existing,
            imageStored,
            imageFingerprint: dto.idImageBase64.slice(0, 32),
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reservations.id, principal.reservationId),
            eq(reservations.propertyId, principal.propertyId),
          ),
        );
    }

    return this.getSession(principal);
  }

  async listUpsells(principal: CheckInPrincipal) {
    const ctx = await this.loadContext(principal);
    const campaigns = (ctx.settings.upsellCampaigns ?? []).filter((c) => c.enabled !== false);
    const arrival = String(ctx.reservation.arrivalDate);
    const eligible = [];

    for (const c of campaigns) {
      if (c.dateFrom && arrival < c.dateFrom) continue;
      if (c.dateTo && arrival > c.dateTo) continue;

      if (c.type === 'room_upgrade') {
        if (!c.targetRoomTypeId || c.targetRoomTypeId === ctx.reservation.roomTypeId) continue;
        const [target] = await this.db
          .select()
          .from(roomTypes)
          .where(
            and(
              eq(roomTypes.id, c.targetRoomTypeId),
              eq(roomTypes.propertyId, principal.propertyId),
              eq(roomTypes.isActive, true),
            ),
          );
        if (!target) continue;
        // Inventory: at least one ready/clean room of target type for arrival night.
        const available = await this.db
          .select({ id: rooms.id })
          .from(rooms)
          .where(
            and(
              eq(rooms.propertyId, principal.propertyId),
              eq(rooms.roomTypeId, c.targetRoomTypeId),
              eq(rooms.isActive, true),
              inArray(rooms.status, ['guest_ready', 'vacant_clean']),
            ),
          )
          .limit(1);
        if (!available.length) continue;
        eligible.push({
          campaignId: c.id,
          type: c.type,
          name: c.name,
          description: c.description ?? `Upgrade to ${target.name}`,
          priceDelta: c.priceDelta ?? 0,
          currencyCode: c.currencyCode || ctx.property.currencyCode,
          targetRoomTypeId: target.id,
          targetRoomTypeName: target.name,
        });
      } else {
        eligible.push({
          campaignId: c.id,
          type: c.type,
          name: c.name,
          description: c.description ?? c.name,
          priceDelta: c.priceDelta ?? 0,
          currencyCode: c.currencyCode || ctx.property.currencyCode,
        });
      }
    }

    return { offers: eligible.sort((a, b) => (a.priceDelta ?? 0) - (b.priceDelta ?? 0)) };
  }

  async acceptUpsell(principal: CheckInPrincipal, dto: GuestAcceptUpsellDto) {
    const ctx = await this.loadContext(principal);
    const campaign = (ctx.settings.upsellCampaigns ?? []).find(
      (c) => c.id === dto.campaignId && c.enabled !== false,
    );
    if (!campaign) throw new NotFoundException('Upsell campaign not found');

    if (campaign.type === 'room_upgrade' && campaign.targetRoomTypeId) {
      await this.db
        .update(reservations)
        .set({
          roomTypeId: campaign.targetRoomTypeId,
          // Clear assignment so auto-assign picks a room of the new type.
          roomId: null,
          status: ctx.reservation.status === 'assigned' ? 'confirmed' : ctx.reservation.status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reservations.id, principal.reservationId),
            eq(reservations.propertyId, principal.propertyId),
          ),
        );
    }

    const amount = Number(campaign.priceDelta ?? 0);
    if (amount > 0) {
      const nights = Number(ctx.reservation.nights ?? 1);
      const chargeAmount =
        campaign.type === 'room_upgrade' ? (amount * nights).toFixed(2) : amount.toFixed(2);

      // Ensure an open folio exists (pre-arrival may not have one yet).
      let folioId: string | null = null;
      const existing = await this.db
        .select()
        .from(folios)
        .where(
          and(
            eq(folios.reservationId, principal.reservationId),
            eq(folios.propertyId, principal.propertyId),
            eq(folios.status, 'open'),
          ),
        )
        .limit(1);
      if (existing[0]) {
        folioId = existing[0].id;
      } else {
        const created = await this.folios.create({
          propertyId: principal.propertyId,
          reservationId: principal.reservationId,
          guestId: ctx.reservation.guestId,
          type: 'guest',
          currencyCode: ctx.reservation.currencyCode || ctx.property.currencyCode,
        });
        folioId = created.id;
      }

      if (folioId) {
        await this.folios.postCharge(folioId, {
          propertyId: principal.propertyId,
          type: campaign.type === 'room_upgrade' ? 'fee' : 'incidental',
          description: campaign.name,
          amount: chargeAmount,
          currencyCode: campaign.currencyCode || ctx.property.currencyCode,
          serviceDate: new Date().toISOString(),
        });
      }
    }

    return this.getSession(principal);
  }

  async pay(principal: CheckInPrincipal, dto: GuestPayDto) {
    const ctx = await this.loadContext(principal);
    const token = dto.paymentMethodId ?? dto.gatewayPaymentToken;
    if (!token) {
      throw new BadRequestException('paymentMethodId or gatewayPaymentToken is required');
    }

    let folio = (
      await this.db
        .select()
        .from(folios)
        .where(
          and(
            eq(folios.reservationId, principal.reservationId),
            eq(folios.propertyId, principal.propertyId),
            eq(folios.status, 'open'),
          ),
        )
        .limit(1)
    )[0];

    if (!folio) {
      folio = await this.folios.create({
        propertyId: principal.propertyId,
        reservationId: principal.reservationId,
        guestId: ctx.reservation.guestId,
        type: 'guest',
        currencyCode: ctx.reservation.currencyCode || ctx.property.currencyCode,
      });
    }

    await this.payments.authorizePayment({
      folioId: folio.id,
      propertyId: principal.propertyId,
      amount: Number(dto.amount).toFixed(2),
      currencyCode: ctx.reservation.currencyCode || ctx.property.currencyCode,
      gatewayProvider: dto.gatewayProvider ?? 'stripe',
      gatewayPaymentToken: token,
      cardLastFour: dto.cardLastFour,
      cardBrand: dto.cardBrand,
    });

    return this.getSession(principal);
  }

  async selfCheckIn(principal: CheckInPrincipal) {
    const session = await this.getSession(principal);
    if (!session.canSelfCheckIn.allowed) {
      throw new BadRequestException(session.canSelfCheckIn.reason ?? 'Self check-in not allowed');
    }

    const ctx = await this.loadContext(principal);
    let roomId = ctx.reservation.roomId as string | null;

    if (ctx.reservation.status === 'confirmed') {
      roomId = await this.autoAssignReadyRoom(
        principal.propertyId,
        ctx.reservation.roomTypeId,
      );
      await this.reservations.assignRoom(principal.reservationId, principal.propertyId, {
        roomId,
      });
    } else if (!roomId) {
      throw new BadRequestException('No room assigned');
    }

    await this.reservations.checkIn(principal.reservationId, principal.propertyId, {
      registrationSigned: true,
      skipDepositAuth: true,
    });

    await this.db
      .update(reservations)
      .set({ onlineCheckInCompletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(reservations.id, principal.reservationId),
          eq(reservations.propertyId, principal.propertyId),
        ),
      );

    return this.getAccess(principal);
  }

  private async autoAssignReadyRoom(propertyId: string, roomTypeId: string): Promise<string> {
    const candidates = await this.db
      .select()
      .from(rooms)
      .where(
        and(
          eq(rooms.propertyId, propertyId),
          eq(rooms.roomTypeId, roomTypeId),
          eq(rooms.isActive, true),
          inArray(rooms.status, ['guest_ready', 'vacant_clean']),
        ),
      )
      .limit(20);

    const sorted = [...candidates].sort((a: any, b: any) => {
      const rank = (s: string) => (s === 'guest_ready' ? 0 : 1);
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return String(a.number).localeCompare(String(b.number));
    });

    if (!sorted[0]) {
      throw new BadRequestException('No ready room available for self check-in');
    }
    return sorted[0].id;
  }

  async getAccess(principal: CheckInPrincipal) {
    const ctx = await this.loadContext(principal);
    if (!['checked_in', 'stayover', 'due_out'].includes(ctx.reservation.status)) {
      throw new BadRequestException('Access is available after check-in');
    }

    const accessMode = ctx.online.accessMode ?? 'unconfigured';
    if (accessMode === 'unconfigured') {
      throw new BadRequestException('Room access is not configured for this property');
    }

    let credential: {
      accessCode?: string | null;
      provider?: string | null;
      mobileKey?: { type?: string; deepLink?: string; payload?: string } | null;
    } | null = null;

    try {
      credential = await this.doorLock.findByReservation(
        principal.reservationId,
        principal.propertyId,
      );
    } catch {
      try {
        credential = await this.doorLock.reissue(
          principal.reservationId,
          principal.propertyId,
        );
      } catch {
        credential = null;
      }
    }

    const accessCode = credential?.accessCode ?? null;
    const mobileKey =
      credential?.mobileKey ??
      (accessCode
        ? {
            type: 'deeplink' as const,
            deepLink: `haip-access://pin/${accessCode}`,
            label: 'Open with phone',
          }
        : null);

    const wallet = this.wallet.build({
      propertyName: ctx.property.name,
      propertyId: principal.propertyId,
      reservationId: principal.reservationId,
      roomNumber: ctx.room?.number ?? null,
      accessCode,
      guestName: ctx.guest
        ? `${ctx.guest.firstName} ${ctx.guest.lastName}`.trim()
        : 'Guest',
      validFrom: ctx.reservation.checkedInAt?.toISOString?.() ?? null,
      validTo: ctx.reservation.departureDate
        ? `${ctx.reservation.departureDate}T${ctx.property.checkOutTime || '11:00'}:00`
        : null,
      instructions: ctx.online.accessInstructions ?? null,
      mobileKeyDeepLink: mobileKey?.deepLink ?? null,
    });

    return {
      roomNumber: ctx.room?.number ?? null,
      accessCode,
      accessMode,
      instructions: ctx.online.accessInstructions ?? null,
      provider: credential?.provider ?? null,
      mobileKey,
      wallet: ctx.online.walletEnabled === false ? { walletEnabled: false } : wallet,
      reservationId: principal.reservationId,
      status: ctx.reservation.status,
    };
  }
}
