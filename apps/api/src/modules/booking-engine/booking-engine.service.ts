import { Injectable, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { bookings, reservations } from '@telivityhaip/database';
import type { DepositPolicy } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { ConnectSearchService } from '../connect/connect-search.service';
import { ConnectBookingService, generateConfirmationToken } from '../connect/connect-booking.service';
import { ReservationService } from '../reservation/reservation.service';
import { AvailabilityService } from '../reservation/availability.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import { TaxService } from '../tax/tax.service';
import { GuestService } from '../guest/guest.service';
import { FolioService } from '../folio/folio.service';
import { PaymentService } from '../payment/payment.service';
import { DepositService } from '../accounting/deposit.service';
import { AncillaryService } from '../ancillary/ancillary.service';
import { BookingEngineConfigService } from './booking-engine-config.service';
import type { BeSearchDto } from './dto/be-search.dto';
import type { BeQuoteDto } from './dto/be-quote.dto';
import type { BeCreateBookingDto } from './dto/be-create-booking.dto';

/**
 * Orchestrates the guest-facing direct booking flow. Adds NO new hotel domain
 * logic — it composes the existing availability / rate / tax / reservation /
 * folio / payment / deposit / ancillary services and applies the property's
 * booking-engine config (sellable inventory + deposit policy). Booking-engine
 * payments are classified as a deposit liability.
 */
@Injectable()
export class BookingEngineService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly searchService: ConnectSearchService,
    private readonly bookingService: ConnectBookingService,
    private readonly reservationService: ReservationService,
    private readonly availabilityService: AvailabilityService,
    private readonly ratePlanService: RatePlanService,
    private readonly taxService: TaxService,
    private readonly guestService: GuestService,
    private readonly folioService: FolioService,
    private readonly paymentService: PaymentService,
    private readonly depositService: DepositService,
    private readonly configService: BookingEngineConfigService,
    private readonly ancillaryService: AncillaryService,
  ) {}

  // --- Search ---

  async search(propertyId: string, dto: BeSearchDto) {
    const config = await this.configService.getPublicConfig(propertyId);
    if (!config.isEnabled) {
      throw new ForbiddenException('Direct booking is not enabled for this property');
    }

    const result = await this.searchService.search({
      propertyId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      roomTypeId: dto.roomTypeId,
      adults: dto.adults,
      children: dto.children,
    } as any);

    // Filter to publicly-sellable room types / rate plans only (fail-closed: an
    // empty allow-list sells nothing).
    const sellableRoomTypes = new Set(config.sellableRoomTypeIds);
    const sellableRatePlans = new Set(config.sellableRatePlanIds);

    const filteredResults = (result.results ?? []).map((property: any) => ({
      ...property,
      roomTypes: (property.roomTypes ?? [])
        .filter((rt: any) => sellableRoomTypes.has(rt.roomTypeId ?? rt.id))
        .map((rt: any) => ({
          ...rt,
          rates: (rt.rates ?? []).filter((r: any) =>
            sellableRatePlans.has(r.ratePlanId ?? r.id),
          ),
        }))
        .filter((rt: any) => (rt.rates ?? []).length > 0),
    })).filter((p: any) => p.roomTypes.length > 0);

    return {
      propertyId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      branding: {
        displayName: config.displayName,
        logoMediaId: config.logoMediaId,
        primaryColor: config.primaryColor,
        accentColor: config.accentColor,
      },
      results: filteredResults,
    };
  }

  // --- Sellable extras ---

  async listSellableServices(propertyId: string) {
    const config = await this.configService.getPublicConfig(propertyId);
    if (!config.isEnabled) {
      throw new ForbiddenException('Direct booking is not enabled for this property');
    }

    const result = await this.ancillaryService.listServices({
      propertyId,
      isActive: 'true',
      channel: 'booking_engine',
      page: 1,
      limit: 100,
    });

    return {
      propertyId,
      data: result.data.map((s: any) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        description: s.description,
        chargeType: s.chargeType,
        price: s.price,
        currencyCode: s.currencyCode,
        postingRule: s.postingRule,
      })),
    };
  }

  // --- Quote ---

  async quote(propertyId: string, dto: BeQuoteDto) {
    const config = await this.configService.getPublicConfig(propertyId);
    this.assertSellable(config, dto.roomTypeId, dto.ratePlanId);

    // Price-tampering guard: `roomTypeId` and `ratePlanId` arrive as two
    // independent client-supplied ids. `assertSellable` only checks each id is
    // individually sellable, so a caller could pair a pricey room type with a
    // cheap room's rate plan and be charged the cheap rate. Each rate plan is
    // bound to exactly one room type — enforce that they match.
    const ratePlanRow = await this.ratePlanService.findById(dto.ratePlanId, propertyId);
    if (ratePlanRow.roomTypeId !== dto.roomTypeId) {
      throw new BadRequestException('Rate plan does not apply to the selected room type');
    }

    const nights = this.nightsBetween(dto.checkIn, dto.checkOut);

    // Re-confirm availability for the requested room type.
    const availability = await this.availabilityService.searchAvailability(
      propertyId,
      dto.checkIn,
      dto.checkOut,
      dto.roomTypeId,
    );
    const avail = availability.find((a: any) => a.roomTypeId === dto.roomTypeId);
    if (!avail || avail.available <= 0) {
      throw new BadRequestException('No availability for the requested room type and dates');
    }

    // Authoritative nightly rate via the rate-plan engine (handles derived rates).
    const { effectiveRate, currency } = await this.ratePlanService.calculateDerivedRate(
      dto.ratePlanId,
      propertyId,
    );

    // Per-night tax via the real tax engine (not a flat property rate).
    const nightlyRate = new Decimal(effectiveRate);
    const lineItems: Array<{ date: string; rate: string; tax: string }> = [];
    let roomTotal = new Decimal(0);
    let taxTotal = new Decimal(0);
    const arrival = new Date(dto.checkIn);

    for (let i = 0; i < nights; i++) {
      const d = new Date(arrival);
      d.setUTCDate(d.getUTCDate() + i);
      const serviceDate = d.toISOString().slice(0, 10);
      const taxes = await this.taxService.calculateTaxes(
        nightlyRate.toFixed(2),
        'room',
        propertyId,
        serviceDate,
        { numberOfNights: nights, nightNumber: i + 1 },
      );
      const nightTax = taxes.reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0));
      roomTotal = roomTotal.plus(nightlyRate);
      taxTotal = taxTotal.plus(nightTax);
      lineItems.push({ date: serviceDate, rate: nightlyRate.toFixed(2), tax: nightTax.toFixed(2) });
    }

    // Optional ancillary extras selected at booking time.
    const services: Array<{
      serviceId: string;
      code: string;
      name: string;
      postingRule: string;
      unitPrice: string;
      quantity: number;
      lineTotal: string;
      taxTotal: string;
    }> = [];
    let servicesTotal = new Decimal(0);
    let servicesTaxTotal = new Decimal(0);

    if (dto.serviceIds?.length) {
      const seen = new Set<string>();
      for (const serviceId of dto.serviceIds) {
        if (seen.has(serviceId)) continue;
        seen.add(serviceId);

        const service = await this.ancillaryService.findServiceById(serviceId, propertyId);
        if (!service.isActive) {
          throw new BadRequestException(`Service ${service.code} is not available`);
        }
        const channels: string[] = Array.isArray(service.sellChannels) ? service.sellChannels : [];
        if (!channels.includes('booking_engine')) {
          throw new BadRequestException(`Service ${service.code} is not available for direct booking`);
        }

        const unitPrice = new Decimal(service.price);
        const postingRule = service.postingRule as string;

        if (postingRule === 'on_consumption') {
          services.push({
            serviceId: service.id,
            code: service.code,
            name: service.name,
            postingRule,
            unitPrice: unitPrice.toFixed(2),
            quantity: 1,
            lineTotal: '0.00',
            taxTotal: '0.00',
          });
          continue;
        }

        // once | per_night | included_in_rate (selected separately → charge unit price)
        const quantity = postingRule === 'per_night' ? nights : 1;
        let lineTotal = unitPrice.times(quantity);
        let lineTax = new Decimal(0);

        if (postingRule === 'per_night') {
          for (let i = 0; i < nights; i++) {
            const d = new Date(arrival);
            d.setUTCDate(d.getUTCDate() + i);
            const serviceDate = d.toISOString().slice(0, 10);
            const taxes = await this.taxService.calculateTaxes(
              unitPrice.toFixed(2),
              service.chargeType,
              propertyId,
              serviceDate,
              { numberOfNights: nights, nightNumber: i + 1 },
            );
            lineTax = lineTax.plus(
              taxes.reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0)),
            );
          }
        } else {
          const taxes = await this.taxService.calculateTaxes(
            unitPrice.toFixed(2),
            service.chargeType,
            propertyId,
            dto.checkIn,
          );
          lineTax = taxes.reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0));
        }

        servicesTotal = servicesTotal.plus(lineTotal);
        servicesTaxTotal = servicesTaxTotal.plus(lineTax);
        services.push({
          serviceId: service.id,
          code: service.code,
          name: service.name,
          postingRule,
          unitPrice: unitPrice.toFixed(2),
          quantity: 1,
          lineTotal: lineTotal.toFixed(2),
          taxTotal: lineTax.toFixed(2),
        });
      }
    }

    const grandTotal = roomTotal.plus(taxTotal).plus(servicesTotal).plus(servicesTaxTotal);
    const depositAmount = this.computeDeposit(
      config.depositPolicy,
      grandTotal,
      roomTotal,
      taxTotal,
      nights,
    );

    return {
      propertyId,
      roomTypeId: dto.roomTypeId,
      ratePlanId: dto.ratePlanId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      nights,
      currencyCode: currency,
      lineItems,
      roomTotal: roomTotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      services,
      servicesTotal: servicesTotal.toFixed(2),
      servicesTaxTotal: servicesTaxTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      depositPolicy: config.depositPolicy,
      depositDue: depositAmount.toFixed(2),
    };
  }

  // --- Book (the heart) ---

  async book(propertyId: string, dto: BeCreateBookingDto) {
    const config = await this.configService.getPublicConfig(propertyId);
    if (!config.isEnabled) {
      throw new ForbiddenException('Direct booking is not enabled for this property');
    }
    this.assertSellable(config, dto.roomTypeId, dto.ratePlanId);
    // Enforce rate restrictions (stop-sell / CTA / CTD / min-max LOS). SEARCH only
    // surfaces these — the BOOK path is the real gate against booking a closed date.
    await this.ratePlanService.assertSellable(propertyId, dto.ratePlanId, dto.checkIn, dto.checkOut);

    // 1. Authoritative server-side re-quote — never trust a client-supplied price.
    const quote = await this.quote(propertyId, {
      roomTypeId: dto.roomTypeId,
      ratePlanId: dto.ratePlanId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      adults: dto.adults,
      children: dto.children,
      serviceIds: dto.serviceIds,
    });

    const depositDue = new Decimal(quote.depositDue);
    if (depositDue.greaterThan(0) && !dto.paymentToken) {
      throw new BadRequestException('A payment is required to confirm this booking');
    }

    // 2. Guest — walk-in exception (no prior reservation; one is created next).
    //    We intentionally do NOT do an unscoped email lookup (cross-tenant PII leak).
    const guest = await this.guestService.create({
      firstName: dto.guestFirstName,
      lastName: dto.guestLastName,
      email: dto.guestEmail,
      phone: dto.guestPhone,
    } as any);

    // 3. Reservation via the canonical path (DNR + FK-ownership + TOCTOU
    //    availability + emits `reservation.created`). High-entropy confirmation
    //    number because the guest uses it as a bearer credential.
    const confirmationNumber = `HAIP-${generateConfirmationToken()}`;
    const reservation = await this.reservationService.create(
      {
        propertyId,
        guestId: guest.id,
        arrivalDate: dto.checkIn,
        departureDate: dto.checkOut,
        roomTypeId: dto.roomTypeId,
        ratePlanId: dto.ratePlanId,
        totalAmount: quote.grandTotal,
        currencyCode: quote.currencyCode,
        adults: dto.adults,
        children: dto.children ?? 0,
        specialRequests: dto.specialRequests,
        source: 'direct',
        channelCode: 'booking_engine',
      } as any,
      { confirmationNumber },
    );

    // 4. Folio.
    const folio = await this.folioService.createAutoFolio({
      id: reservation.id,
      propertyId,
      bookingId: reservation.bookingId,
      guestId: guest.id,
      currencyCode: quote.currencyCode,
    });

    // 4b. Attach selected extras (posting deferred to check-in / night audit).
    if (dto.serviceIds?.length) {
      const seen = new Set<string>();
      for (const serviceId of dto.serviceIds) {
        if (seen.has(serviceId)) continue;
        seen.add(serviceId);
        await this.ancillaryService.attachToReservation(reservation.id, {
          propertyId,
          serviceId,
          sourceChannel: 'booking_engine',
        });
      }
      await this.ancillaryService.ensurePackageComponents(reservation.id, propertyId);
    } else {
      await this.ancillaryService.ensurePackageComponents(reservation.id, propertyId);
    }

    // 5 + 6. Take the deposit (hold) and classify it as a deposit liability.
    let depositInfo: { paymentId: string; amount: string; status: string } | null = null;
    if (depositDue.greaterThan(0) && dto.paymentToken) {
      const payment = await this.paymentService.authorizePayment({
        folioId: folio.id,
        propertyId,
        amount: depositDue.toFixed(2),
        currencyCode: quote.currencyCode,
        gatewayProvider: 'stripe',
        gatewayPaymentToken: dto.paymentToken,
        cardLastFour: dto.cardLastFour,
        cardBrand: dto.cardBrand,
      } as any);

      const policy = config.depositPolicy as DepositPolicy;
      await this.depositService.recordDeposit({
        propertyId,
        reservationId: reservation.id,
        paymentId: payment.id,
        amount: depositDue.toFixed(2),
        currencyCode: quote.currencyCode,
        isRefundable: policy.refundable,
      } as any);

      depositInfo = { paymentId: payment.id, amount: depositDue.toFixed(2), status: 'held' };
    }

    // 7. Auto-confirm only if configured (otherwise leave 'pending').
    let status = reservation.status;
    if (config.isEnabled && depositInfo && (await this.shouldAutoConfirm(propertyId))) {
      const confirmed = await this.reservationService.confirm(reservation.id, propertyId);
      status = confirmed.status;
    }

    return {
      success: true,
      confirmationNumber,
      reservationId: reservation.id,
      status,
      currencyCode: quote.currencyCode,
      grandTotal: quote.grandTotal,
      deposit: depositInfo,
      lineItems: quote.lineItems,
      services: quote.services,
      servicesTotal: quote.servicesTotal,
      servicesTaxTotal: quote.servicesTaxTotal,
      cancellationPolicy: (config.depositPolicy as DepositPolicy).refundable
        ? 'Deposit refundable per property policy.'
        : 'Deposit non-refundable.',
    };
  }

  // --- Retrieve / cancel (ownership already enforced by BookingEngineScopeGuard) ---

  async verify(confirmationNumber: string) {
    return this.bookingService.verify(confirmationNumber);
  }

  async cancel(propertyId: string, confirmationNumber: string, reason?: string) {
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.confirmationNumber, confirmationNumber),
          eq(bookings.propertyId, propertyId),
        ),
      );
    if (!booking) {
      // Mirror the scope guard's non-leaking behavior.
      throw new ForbiddenException('Booking key is not scoped to this booking');
    }
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.bookingId, booking.id),
          eq(reservations.propertyId, propertyId),
        ),
      );
    if (!reservation) {
      throw new BadRequestException('Reservation not found for this booking');
    }

    const updated = await this.reservationService.cancel(reservation.id, propertyId, {
      cancellationReason: reason ?? 'Cancelled by guest via booking engine',
    } as any);

    return {
      cancelled: true,
      confirmationNumber,
      reservationId: reservation.id,
      status: updated.status,
    };
  }

  // --- Helpers ---

  private assertSellable(config: { sellableRoomTypeIds: string[]; sellableRatePlanIds: string[] }, roomTypeId: string, ratePlanId: string) {
    if (!config.sellableRoomTypeIds.includes(roomTypeId)) {
      throw new BadRequestException('This room type is not available for direct booking');
    }
    if (!config.sellableRatePlanIds.includes(ratePlanId)) {
      throw new BadRequestException('This rate is not available for direct booking');
    }
  }

  private async shouldAutoConfirm(propertyId: string): Promise<boolean> {
    const cfg = await this.configService.getConfig(propertyId);
    return cfg.autoConfirm === true;
  }

  private nightsBetween(checkIn: string, checkOut: string): number {
    const a = new Date(checkIn);
    const b = new Date(checkOut);
    const nights = Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
    if (nights <= 0) {
      throw new BadRequestException('Check-out must be after check-in');
    }
    return nights;
  }

  /**
   * Deposit amount from policy. Default classification is "deposit";
   * the AMOUNT (first night / percentage / full) is property-configurable.
   */
  private computeDeposit(
    policy: DepositPolicy,
    grandTotal: Decimal,
    roomTotal: Decimal,
    taxTotal: Decimal,
    nights: number,
  ): Decimal {
    switch (policy.type) {
      case 'none':
        return new Decimal(0);
      case 'full':
        return grandTotal;
      case 'percentage': {
        const pct = new Decimal(policy.percentage ?? 0).div(100);
        return grandTotal.times(pct).toDecimalPlaces(2);
      }
      case 'first_night':
      default: {
        // One night of room + its share of tax (total / nights).
        if (nights <= 0) return grandTotal;
        return grandTotal.div(nights).toDecimalPlaces(2);
      }
    }
  }
}
