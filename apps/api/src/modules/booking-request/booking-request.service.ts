import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { bookingRequests } from '@telivityhaip/database';
import type { PaymentMethodCollection } from '@telivityhaip/database';
import type { WebhookEvent } from '@telivityhaip/shared';
import { DRIZZLE } from '../../database/database.module';
import { BookingEngineConfigService } from '../booking-engine/booking-engine-config.service';
import { BookingEngineService } from '../booking-engine/booking-engine.service';
import { validateApplicationAnswers } from '../booking-engine/booking-form-questions';
import {
  SAVED_PAYMENT_METHOD_GATEWAY,
  type SavedPaymentMethod,
  type SavedPaymentMethodGateway,
} from '../payment/interfaces/saved-payment-method-gateway.interface';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import { AvailabilityService } from '../reservation/availability.service';
import { WebhookService } from '../webhook/webhook.service';
import type { CreateRequestCardSetupDto } from './dto/create-request-card-setup.dto';
import type { SubmitBookingRequestDto } from './dto/submit-booking-request.dto';

export type BookingRequestAcknowledgement = {
  requestId: string;
  status: 'pending';
  message: string;
};

type PublicRequestConfig = Awaited<
  ReturnType<BookingEngineConfigService['getPublicConfig']>
>;

type CardSnapshot = {
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  cardLastFour: string | null;
  cardBrand: string | null;
  consentText: string | null;
  consentVersion: string | null;
  consentedAt: Date | null;
};

type BookingRequestDatabase = {
  insert(table: typeof bookingRequests): {
    values(input: typeof bookingRequests.$inferInsert): {
      returning(selection: { id: typeof bookingRequests.id }): Promise<Array<{ id: string }>>;
    };
  };
};

const ACKNOWLEDGEMENT_MESSAGE =
  'Your booking request has been received and is pending review.';

@Injectable()
export class BookingRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BookingRequestDatabase,
    @Inject(BookingEngineConfigService)
    private readonly configService: BookingEngineConfigService,
    @Inject(BookingEngineService)
    private readonly bookingEngineService: BookingEngineService,
    @Inject(AvailabilityService)
    private readonly availabilityService: AvailabilityService,
    @Inject(RatePlanService)
    private readonly ratePlanService: RatePlanService,
    @Inject(SAVED_PAYMENT_METHOD_GATEWAY)
    private readonly savedPaymentMethodGateway: SavedPaymentMethodGateway,
    @Inject(WebhookService) private readonly webhookService: WebhookService,
  ) {}

  async createPaymentMethodSetup(
    propertyId: string,
    dto: CreateRequestCardSetupDto,
  ): Promise<{ setupIntentId: string; clientSecret: string }> {
    const config = await this.configService.getPublicConfig(propertyId);
    this.assertRequestMode(config);
    if (config.paymentMethodCollection === 'disabled') {
      throw new BadRequestException('Payment method collection is disabled for booking requests');
    }
    if (!config.stripePublishableKey?.trim()) {
      throw new BadRequestException('Payment method collection is unavailable for this property');
    }

    const setup = await this.savedPaymentMethodGateway.createSetup(
      dto.guestEmail,
      `booking-request:${propertyId}:${dto.idempotencyKey}`,
    );
    return {
      setupIntentId: setup.setupIntentId,
      clientSecret: setup.clientSecret,
    };
  }

  async submit(
    propertyId: string,
    dto: SubmitBookingRequestDto,
  ): Promise<BookingRequestAcknowledgement> {
    const config = await this.configService.getPublicConfig(propertyId);
    this.assertRequestMode(config);
    this.assertConfiguredOffer(config, dto.roomTypeId, dto.ratePlanId);

    const applicationAnswers = validateApplicationAnswers(
      config.formQuestions,
      dto.applicationAnswers,
    );
    this.assertCardPolicyInput(config.paymentMethodCollection, dto);

    await this.ratePlanService.assertSellable(
      propertyId,
      dto.ratePlanId,
      dto.checkIn,
      dto.checkOut,
    );
    await this.assertAvailable(propertyId, dto);

    const quote = await this.bookingEngineService.quote(propertyId, {
      roomTypeId: dto.roomTypeId,
      ratePlanId: dto.ratePlanId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      adults: dto.adults,
      children: dto.children,
      serviceIds: dto.serviceIds,
    });
    const card = await this.resolveCard(config.paymentMethodCollection, dto);

    const [request] = await this.db
      .insert(bookingRequests)
      .values({
        propertyId,
        status: 'pending',
        arrivalDate: dto.checkIn,
        departureDate: dto.checkOut,
        roomTypeId: dto.roomTypeId,
        ratePlanId: dto.ratePlanId,
        adults: dto.adults,
        children: dto.children ?? 0,
        guestFirstName: dto.guestFirstName,
        guestLastName: dto.guestLastName,
        guestEmail: dto.guestEmail,
        guestPhone: dto.guestPhone ?? null,
        specialRequests: dto.specialRequests ?? null,
        serviceIds: structuredClone(dto.serviceIds ?? []),
        formSnapshot: structuredClone(config.formQuestions),
        applicationAnswers: structuredClone(applicationAnswers),
        submittedQuoteSnapshot: structuredClone(quote),
        currentQuoteSnapshot: null,
        currencyCode: quote.currencyCode,
        ...card,
      })
      .returning({ id: bookingRequests.id });

    if (!request) {
      throw new InternalServerErrorException('Booking request could not be created');
    }

    await this.webhookService.emit(
      // Request webhook types are completed with the staff lifecycle events.
      'booking_request.created' as unknown as WebhookEvent,
      'booking_request',
      request.id,
      { requestId: request.id, status: 'pending' },
      propertyId,
    );

    return {
      requestId: request.id,
      status: 'pending',
      message: ACKNOWLEDGEMENT_MESSAGE,
    };
  }

  private assertRequestMode(config: PublicRequestConfig): void {
    if (!config.isEnabled) {
      throw new ForbiddenException('Direct booking is not enabled for this property');
    }
    if (config.bookingMode !== 'request') {
      throw new ForbiddenException('Booking requests are not enabled for this property');
    }
  }

  private assertConfiguredOffer(
    config: PublicRequestConfig,
    roomTypeId: string,
    ratePlanId: string,
  ): void {
    if (!config.sellableRoomTypeIds.includes(roomTypeId)) {
      throw new BadRequestException('This room type is not available for direct booking');
    }
    if (!config.sellableRatePlanIds.includes(ratePlanId)) {
      throw new BadRequestException('This rate is not available for direct booking');
    }
  }

  private assertCardPolicyInput(
    policy: PaymentMethodCollection,
    dto: SubmitBookingRequestDto,
  ): void {
    const hasSetup = Boolean(dto.setupIntentId?.trim());
    const hasConsentData = dto.consentAccepted !== undefined
      || dto.consentText !== undefined
      || dto.consentVersion !== undefined;

    if (policy === 'disabled') {
      if (hasSetup || hasConsentData) {
        throw new BadRequestException('Payment method collection is disabled for booking requests');
      }
      return;
    }

    if (!hasSetup) {
      if (policy === 'required') {
        throw new BadRequestException('A saved payment method is required for this booking request');
      }
      if (hasConsentData) {
        throw new BadRequestException('Card consent requires a saved payment method');
      }
      return;
    }

    if (
      dto.consentAccepted !== true
      || !dto.consentText?.trim()
      || !dto.consentVersion?.trim()
    ) {
      throw new BadRequestException(
        'Explicit versioned consent is required to save a payment method',
      );
    }
  }

  private async resolveCard(
    policy: PaymentMethodCollection,
    dto: SubmitBookingRequestDto,
  ): Promise<CardSnapshot> {
    if (policy === 'disabled' || !dto.setupIntentId) {
      return this.emptyCardSnapshot();
    }

    let savedMethod: SavedPaymentMethod;
    try {
      savedMethod = await this.savedPaymentMethodGateway.resolveSetup(dto.setupIntentId);
    } catch {
      throw new BadRequestException('Payment method setup is incomplete or invalid');
    }

    return {
      stripeCustomerId: savedMethod.customerId,
      stripePaymentMethodId: savedMethod.paymentMethodId,
      cardLastFour: savedMethod.cardLastFour,
      cardBrand: savedMethod.cardBrand,
      consentText: dto.consentText!.trim(),
      consentVersion: dto.consentVersion!.trim(),
      consentedAt: new Date(),
    };
  }

  private emptyCardSnapshot(): CardSnapshot {
    return {
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      cardLastFour: null,
      cardBrand: null,
      consentText: null,
      consentVersion: null,
      consentedAt: null,
    };
  }

  private async assertAvailable(
    propertyId: string,
    dto: Pick<SubmitBookingRequestDto, 'checkIn' | 'checkOut' | 'roomTypeId'>,
  ): Promise<void> {
    const availability = await this.availabilityService.searchAvailability(
      propertyId,
      dto.checkIn,
      dto.checkOut,
      dto.roomTypeId,
    );
    const byDate = new Map(
      availability
        .filter((row) => row.roomTypeId === dto.roomTypeId)
        .map((row) => [row.date, row.available]),
    );

    for (const date of this.stayDates(dto.checkIn, dto.checkOut)) {
      if ((byDate.get(date) ?? 0) <= 0) {
        throw new ConflictException(
          'No availability for the requested room type and dates; use the waitlist instead',
        );
      }
    }
  }

  private stayDates(checkIn: string, checkOut: string): string[] {
    const dates: string[] = [];
    const current = new Date(`${checkIn}T00:00:00.000Z`);
    const departure = new Date(`${checkOut}T00:00:00.000Z`);
    while (current < departure) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }
}
