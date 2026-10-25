import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  bookingEngineConfig,
  bookings,
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
import { StorageService } from '../media/storage/storage.service';
import { EmailService } from '../agent/guest-comms/email.service';
import {
  defaultTokenTtlSeconds,
  maxTokenTtlSeconds,
  signCheckInToken,
} from './check-in-token';
import { resolveCheckInMagicSecret } from './check-in-secret';
import { buildCheckInAppUrl } from './check-in-app-url';
import { WalletPassService } from './wallet-pass.service';
import {
  decryptIdImageBuffer,
  encryptIdImageBuffer,
} from './id-image-encryption';
import {
  isPaymentGatewayMockMode,
  resolvePaymentGatewayProvider,
} from '../payment/payment-gateway.factory';
import type {
  GuestAcceptUpsellDto,
  GuestPayDto,
  GuestPreRegisterDto,
  RequestCheckInLinkDto,
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
  privacyPolicyUrl?: string;
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
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  private magicSecret(): string {
    return resolveCheckInMagicSecret(this.config);
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

    const ttl = Math.min(
      Math.max(ttlSeconds ?? defaultTokenTtlSeconds(), 60),
      maxTokenTtlSeconds(),
    );
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
      url: buildCheckInAppUrl(origin, token),
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

    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.id, reservation.bookingId),
          eq(bookings.propertyId, principal.propertyId),
        ),
      )
      .limit(1);

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

    return { reservation, booking: booking ?? null, property, guest, room, roomType, online, settings };
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
        confirmationNumber: ctx.booking?.confirmationNumber ?? ctx.reservation.id.slice(0, 8),
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
      roomReady: Boolean(roomReady),
      canSelfCheckIn,
      privacyPolicyUrl:
        (online.privacyPolicyUrl ||
          (ctx.property as { website?: string | null }).website ||
          null) ?? null,
      steps: {
        registration: registrationComplete,
        id: Boolean(
          (ctx.reservation.guestIdDocument as any)?.imageMediaId ||
            (ctx.reservation.guestIdDocument as any)?.imageStored,
        ),
        payment: folioBalance <= 0.009 || !configFlags.requirePaymentWhenBalanceDue,
        checkedIn: ['checked_in', 'stayover', 'due_out'].includes(ctx.reservation.status),
      },
      payment: await this.payments.getClientConfig(principal.propertyId),
      francePackEnabled: Boolean((ctx.property.settings as any)?.francePack?.enabled),
      stripePublishableKey: this.config.get<string>('STRIPE_PUBLISHABLE_KEY') ?? null,
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
      if (!doc?.['imageMediaId']) {
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

    this.assertFranceFicheFields(ctx, dto.registrationData);

    let imageMediaId: string | undefined;
    let imageStorageKey: string | undefined;
    let imageEncrypted = false;
    if (dto.idImageBase64) {
      const stored = await this.storeIdImage(
        principal.propertyId,
        principal.reservationId,
        dto.idImageBase64,
      );
      imageMediaId = stored.mediaId;
      imageStorageKey = stored.storageKey;
      imageEncrypted = stored.encrypted;
    } else if (ctx.online.requireIdPhoto !== false) {
      throw new BadRequestException('ID photo is required');
    }

    const registrationData = {
      ...(dto.registrationData ?? {}),
      ...(imageMediaId
        ? {
            idPhotoCapturedAt: new Date().toISOString(),
            idPhotoPresent: true,
            imageMediaId,
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

    if (imageMediaId) {
      const existing = (updated.guestIdDocument ?? {}) as Record<string, unknown>;
      await this.db
        .update(reservations)
        .set({
          guestIdDocument: {
            ...existing,
            imageMediaId,
            imageStorageKey,
            imageStored: true,
            imageEncrypted,
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

    // Keep guest profile in sync for France fiche / FD (nationality, contact, names).
    const rd = registrationData as Record<string, unknown>;
    if (ctx.guest?.id) {
      const guestPatch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof rd['firstName'] === 'string') guestPatch['firstName'] = rd['firstName'];
      if (typeof rd['lastName'] === 'string') guestPatch['lastName'] = rd['lastName'];
      if (typeof rd['email'] === 'string') guestPatch['email'] = rd['email'];
      if (typeof rd['phone'] === 'string') guestPatch['phone'] = rd['phone'];
      if (typeof rd['nationality'] === 'string') guestPatch['nationality'] = rd['nationality'];
      if (typeof rd['dateOfBirth'] === 'string') guestPatch['dateOfBirth'] = new Date(rd['dateOfBirth']);
      if (typeof rd['address'] === 'string') guestPatch['addressLine1'] = rd['address'];
      if (dto.idType) guestPatch['idType'] = dto.idType;
      if (dto.idNumber) guestPatch['idNumber'] = dto.idNumber;
      if (dto.idCountry) guestPatch['idCountry'] = dto.idCountry;
      await this.db.update(guests).set(guestPatch).where(eq(guests.id, ctx.guest.id));
    }

    return this.getSession(principal);
  }

  private async storeIdImage(
    propertyId: string,
    reservationId: string,
    dataUrlOrBase64: string,
  ): Promise<{ mediaId: string; storageKey: string; encrypted: boolean }> {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrlOrBase64);
    const contentType = match?.[1] || 'image/jpeg';
    const b64 = match?.[2] || dataUrlOrBase64;
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length < 32) {
      throw new BadRequestException('ID photo is empty or invalid');
    }
    if (buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('ID photo must be under 8MB');
    }
    const sealed = encryptIdImageBuffer(buffer, contentType);
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const put = await this.storage.put(sealed.buffer, {
      propertyId,
      contentType: sealed.encrypted ? 'application/octet-stream' : contentType,
      filename: `guest-id-${reservationId}.${sealed.encrypted ? 'bin' : ext}`,
    });
    // mediaId = storage key (guest-scoped; not the staff media table).
    return {
      mediaId: put.storageKey,
      storageKey: put.storageKey,
      encrypted: sealed.encrypted,
    };
  }

  async listUpsells(principal: CheckInPrincipal) {
    const ctx = await this.loadContext(principal);
    const campaigns = (ctx.settings.upsellCampaigns ?? []).filter((c) => c.enabled !== false);
    const arrival = String(ctx.reservation.arrivalDate);
    const accepted = Array.isArray(
      (ctx.reservation.registrationData as any)?.acceptedUpsellCampaignIds,
    )
      ? ((ctx.reservation.registrationData as any).acceptedUpsellCampaignIds as string[])
      : [];
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
        const available = await this.findAssignableRooms(
          principal.propertyId,
          c.targetRoomTypeId,
          String(ctx.reservation.arrivalDate),
          String(ctx.reservation.departureDate),
          principal.reservationId,
        );
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
          alreadyAccepted: accepted.includes(c.id),
        });
      } else {
        eligible.push({
          campaignId: c.id,
          type: c.type,
          name: c.name,
          description: c.description ?? c.name,
          priceDelta: c.priceDelta ?? 0,
          currencyCode: c.currencyCode || ctx.property.currencyCode,
          alreadyAccepted: accepted.includes(c.id),
        });
      }
    }

    return { offers: eligible.sort((a, b) => (a.priceDelta ?? 0) - (b.priceDelta ?? 0)) };
  }

  /**
   * Public: re-send a check-in magic link when confirmation + guest email match.
   * Always returns a generic success message (no enumeration).
   */
  async requestLink(dto: RequestCheckInLinkDto) {
    const confirmation = dto.confirmationNumber.trim();
    const email = dto.email.trim().toLowerCase();
    const propertyId = dto.propertyId;
    const generic = {
      ok: true as const,
      message: 'If we find a matching reservation, a new check-in link will be emailed shortly.',
    };

    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);
    if (!property) return generic;

    const online = ((property.settings ?? {}) as { onlineCheckIn?: OnlineCheckInSettings })
      .onlineCheckIn;
    if (online?.enabled === false) return generic;

    // Confirmation numbers live on bookings (party wrapper), not reservations.
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.confirmationNumber, confirmation),
          eq(bookings.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!booking) return generic;

    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.bookingId, booking.id),
          eq(reservations.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!reservation) return generic;

    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, reservation.guestId))
      .limit(1);
    if (!guest?.email || String(guest.email).trim().toLowerCase() !== email) {
      return generic;
    }

    const link = await this.issueLinkForReservation(propertyId, reservation.id);
    const hotel = property.staffDisplayName || property.name || 'your hotel';
    try {
      await this.email.send({
        to: email,
        subject: `Your check-in link for ${hotel}`,
        text: `Here is your online check-in link:\n\n${link.url}\n\nThis link expires soon. If you did not request it, you can ignore this email.`,
        html: `<p>Here is your online check-in link for <strong>${hotel}</strong>:</p><p><a href="${link.url}">Continue check-in</a></p><p>This link expires soon. If you did not request it, you can ignore this email.</p>`,
      });
    } catch {
      // Still return generic OK — do not leak delivery failures.
    }
    return generic;
  }

  async acceptUpsell(principal: CheckInPrincipal, dto: GuestAcceptUpsellDto) {
    const ctx = await this.loadContext(principal);
    if (['checked_in', 'stayover', 'due_out', 'cancelled', 'no_show', 'checked_out'].includes(
      ctx.reservation.status,
    )) {
      throw new BadRequestException('Upsells cannot be added after check-in');
    }
    const campaign = (ctx.settings.upsellCampaigns ?? []).find(
      (c) => c.id === dto.campaignId && c.enabled !== false,
    );
    if (!campaign) throw new NotFoundException('Upsell campaign not found');

    const regData = (ctx.reservation.registrationData ?? {}) as Record<string, unknown>;
    const accepted = Array.isArray(regData['acceptedUpsellCampaignIds'])
      ? (regData['acceptedUpsellCampaignIds'] as string[])
      : [];
    if (accepted.includes(dto.campaignId)) {
      throw new BadRequestException('This upgrade was already added');
    }

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
      const folioId = existing[0]
        ? existing[0].id
        : (
            await this.folios.create({
              propertyId: principal.propertyId,
              reservationId: principal.reservationId,
              guestId: ctx.reservation.guestId,
              type: 'guest',
              currencyCode: ctx.reservation.currencyCode || ctx.property.currencyCode,
            })
          ).id;

      await this.folios.postCharge(folioId, {
        propertyId: principal.propertyId,
        type: campaign.type === 'room_upgrade' ? 'fee' : 'incidental',
        description: campaign.name,
        amount: chargeAmount,
        currencyCode: campaign.currencyCode || ctx.property.currencyCode,
        serviceDate: new Date().toISOString(),
      });
    }

    await this.db
      .update(reservations)
      .set({
        registrationData: {
          ...regData,
          acceptedUpsellCampaignIds: [...accepted, dto.campaignId],
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservations.id, principal.reservationId),
          eq(reservations.propertyId, principal.propertyId),
        ),
      );

    return this.getSession(principal);
  }

  async pay(principal: CheckInPrincipal, dto: GuestPayDto) {
    const ctx = await this.loadContext(principal);
    const token = dto.paymentMethodId ?? dto.gatewayPaymentToken;
    if (!token) {
      throw new BadRequestException('paymentMethodId or gatewayPaymentToken is required');
    }

    const configuredProvider = resolvePaymentGatewayProvider(this.config);
    const requestedProvider = (dto.gatewayProvider ?? configuredProvider).toLowerCase();
    if (requestedProvider === 'mock' && !isPaymentGatewayMockMode()) {
      throw new BadRequestException('Mock payment gateway is not enabled');
    }
    // Prefer server-configured gateway; mock only when mock mode is enabled.
    const gatewayProvider = isPaymentGatewayMockMode() ? 'mock' : configuredProvider;

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

    const balance = Number(folio.balance ?? 0);
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount < 0.01) {
      throw new BadRequestException('Payment amount is invalid');
    }
    if (amount > balance + 0.009) {
      throw new BadRequestException(
        `Payment amount exceeds outstanding balance (${balance.toFixed(2)})`,
      );
    }

    const returnUrl = dto.returnUrl?.trim();
    const result = await this.payments.authorizePayment({
      folioId: folio.id,
      propertyId: principal.propertyId,
      amount: amount.toFixed(2),
      currencyCode: ctx.reservation.currencyCode || ctx.property.currencyCode,
      gatewayProvider,
      gatewayPaymentToken: token,
      cardLastFour: dto.cardLastFour,
      cardBrand: dto.cardBrand,
      ...(returnUrl
        ? { redirectUrlOk: returnUrl, redirectUrlKo: returnUrl }
        : {}),
    });

    const session = await this.getSession(principal);
    return {
      ...session,
      ...(result.nextAction ? { nextAction: result.nextAction } : {}),
    };
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
        String(ctx.reservation.arrivalDate),
        String(ctx.reservation.departureDate),
        principal.reservationId,
      );
      await this.reservations.assignRoom(principal.reservationId, principal.propertyId, {
        roomId,
      });
    } else if (!roomId) {
      throw new BadRequestException('No room assigned');
    }

    const depositRequired = await this.isDepositRequired(principal.propertyId, ctx.property.settings);
    const balance = await this.folioBalanceForReservation(
      principal.reservationId,
      principal.propertyId,
    );
    if (depositRequired && balance > 0.009) {
      throw new BadRequestException('Deposit / balance must be paid before self check-in');
    }

    await this.reservations.checkIn(principal.reservationId, principal.propertyId, {
      registrationSigned: true,
      // Only skip deposit auth when policy does not require it or balance is already clear.
      skipDepositAuth: !depositRequired || balance <= 0.009,
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

  private async autoAssignReadyRoom(
    propertyId: string,
    roomTypeId: string,
    arrivalDate: string,
    departureDate: string,
    excludeReservationId: string,
  ): Promise<string> {
    const candidates = await this.findAssignableRooms(
      propertyId,
      roomTypeId,
      arrivalDate,
      departureDate,
      excludeReservationId,
    );
    if (!candidates[0]) {
      throw new BadRequestException('No ready room available for self check-in');
    }
    return candidates[0].id;
  }

  /** Clean/ready rooms of type not held by overlapping assigned/in-house stays. */
  private async findAssignableRooms(
    propertyId: string,
    roomTypeId: string,
    arrivalDate: string,
    departureDate: string,
    excludeReservationId: string,
  ): Promise<Array<{ id: string; number: string; status: string }>> {
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
      .limit(50);

    const held = await this.db
      .select({ roomId: reservations.roomId })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          ne(reservations.id, excludeReservationId),
          inArray(reservations.status, ['assigned', 'checked_in', 'stayover', 'due_out']),
          sql`${reservations.arrivalDate} < ${departureDate}`,
          sql`${reservations.departureDate} > ${arrivalDate}`,
        ),
      );
    const heldIds = new Set(
      held.map((h: { roomId: string | null }) => h.roomId).filter(Boolean),
    );

    return [...candidates]
      .filter((r: any) => !heldIds.has(r.id))
      .sort((a: any, b: any) => {
        const rank = (s: string) => (s === 'guest_ready' ? 0 : 1);
        const r = rank(a.status) - rank(b.status);
        if (r !== 0) return r;
        return String(a.number).localeCompare(String(b.number));
      });
  }

  async getAccess(principal: CheckInPrincipal) {
    const ctx = await this.loadContext(principal);
    if (['checked_out', 'cancelled', 'no_show'].includes(ctx.reservation.status)) {
      throw new BadRequestException('Room access is no longer available for this stay');
    }
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
    } | null;
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

    // Never surface a console/demo PIN as a smart-lock digital key.
    let accessCode = credential?.accessCode ?? null;
    let mobileKey = credential?.mobileKey ?? null;
    let provider = credential?.provider ?? null;
    let accessUnavailableReason: string | null = null;
    if (accessMode === 'smart_lock') {
      const providerName = String(provider || '').toLowerCase();
      if (!accessCode || providerName === 'console' || !credential) {
        accessCode = null;
        mobileKey = null;
        provider = providerName === 'console' ? null : provider;
        accessUnavailableReason =
          'Digital room key is unavailable. Please contact the front desk.';
      }
    }

    const wallet =
      ctx.online.walletEnabled === false
        ? { walletEnabled: false }
        : this.wallet.build({
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
      provider,
      mobileKey,
      wallet,
      reservationId: principal.reservationId,
      status: ctx.reservation.status,
      ...(accessUnavailableReason ? { accessUnavailableReason } : {}),
    };
  }

  async createWorldlineTokenization(principal: CheckInPrincipal) {
    return this.payments.createWorldlineTokenizationSession(principal.propertyId);
  }

  /** Staff: whether an ID photo object exists for a reservation. */
  async getIdPhotoMeta(propertyId: string, reservationId: string) {
    const [row] = await this.db
      .select({ guestIdDocument: reservations.guestIdDocument })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    const doc = (row?.guestIdDocument ?? {}) as Record<string, unknown>;
    return {
      hasIdPhoto: Boolean(doc['imageMediaId']),
      imageMediaId: (doc['imageMediaId'] as string) || null,
      contentPath: `/api/v1/guest-check-in/id-photo/content?propertyId=${encodeURIComponent(propertyId)}&reservationId=${encodeURIComponent(reservationId)}`,
    };
  }

  /** Staff: load stored ID photo bytes for download/preview. */
  async getIdPhotoContent(propertyId: string, reservationId: string) {
    const [row] = await this.db
      .select({ guestIdDocument: reservations.guestIdDocument })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    if (!row) throw new NotFoundException('Reservation not found');
    const doc = (row.guestIdDocument ?? {}) as Record<string, unknown>;
    const key = String(doc['imageStorageKey'] || doc['imageMediaId'] || '');
    if (!key) throw new NotFoundException('No ID photo on file');

    const stored = await this.storage.get(key);
    if (!stored) throw new NotFoundException('ID photo file missing');
    const decrypted = decryptIdImageBuffer(stored);
    const buffer = decrypted.buffer;
    const extFromKey = key.split('.').pop()?.toLowerCase();
    const contentType =
      decrypted.contentType ||
      (extFromKey === 'png'
        ? 'image/png'
        : extFromKey === 'webp'
          ? 'image/webp'
          : 'image/jpeg');
    const ext =
      contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    return { buffer, contentType, filename: `guest-id-${reservationId}.${ext}` };
  }

  private assertFranceFicheFields(
    ctx: Awaited<ReturnType<GuestCheckInService['loadContext']>>,
    registrationData?: Record<string, unknown>,
  ) {
    const franceEnabled = Boolean((ctx.property.settings as any)?.francePack?.enabled);
    if (!franceEnabled) return;
    const rd = registrationData ?? {};
    const nationality = String(
      rd['nationality'] ?? ctx.guest?.nationality ?? '',
    )
      .trim()
      .toUpperCase();
    const isFr = nationality === 'FR' || nationality === 'FRA' || nationality === 'FRANCE';
    // Empty nationality is treated as incomplete (matches front-desk fiche guards).
    if (isFr) return;

    const missing: string[] = [];
    if (!nationality) missing.push('nationality');
    const need = (key: string, label: string) => {
      if (!String(rd[key] ?? '').trim()) missing.push(label);
    };
    need('firstName', 'first name');
    need('lastName', 'last name');
    need('dateOfBirth', 'date of birth');
    need('placeOfBirth', 'place of birth');
    need('address', 'home address');
    need('phone', 'mobile phone');
    need('email', 'email');
    if (missing.length) {
      throw new BadRequestException(
        `Fiche de police (non-French guest): required — ${missing.join(', ')}`,
      );
    }
  }

  private async isDepositRequired(
    propertyId: string,
    propertySettings: unknown,
  ): Promise<boolean> {
    const settings = (propertySettings ?? {}) as {
      depositAuthRequired?: boolean;
      depositPercentage?: number;
    };
    if (settings.depositAuthRequired && Number(settings.depositPercentage ?? 0) > 0) {
      return true;
    }
    try {
      const [cfg] = await this.db
        .select({ depositPolicy: bookingEngineConfig.depositPolicy })
        .from(bookingEngineConfig)
        .where(eq(bookingEngineConfig.propertyId, propertyId))
        .limit(1);
      const policy = (cfg?.depositPolicy ?? {}) as { type?: string };
      return Boolean(policy.type && policy.type !== 'none');
    } catch {
      return false;
    }
  }
}
