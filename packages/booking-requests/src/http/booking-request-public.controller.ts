import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '@telivityhaip/shared';
import {
  BookingEngineScopeGuardBridge,
  BookingKeyGuardBridge,
  BookingThrottleGuardBridge,
} from '../module/guard-bridges.js';
import { BookingRequestService } from '../domain/booking-request.service.js';
// DTO classes must remain runtime imports for Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateRequestCardSetupDto } from './dto/create-request-card-setup.dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SubmitBookingRequestDto } from './dto/submit-booking-request.dto.js';

type BookingEngineRequest = {
  bookingEngine: { propertyId: string };
};

@ApiTags('Booking Engine — Booking Requests')
@ApiSecurity('booking-key')
@Controller('booking-engine')
@Public()
@UseGuards(BookingKeyGuardBridge, BookingEngineScopeGuardBridge)
export class BookingRequestPublicController {
  constructor(
    @Inject(BookingRequestService) private readonly service: BookingRequestService,
  ) {}

  @Post('request-payment-method-setup')
  @UseGuards(BookingThrottleGuardBridge)
  @ApiOperation({ summary: 'Prepare optional or required request card collection' })
  @ApiResponse({ status: 201, description: 'SetupIntent client details' })
  createSetup(@Body() dto: CreateRequestCardSetupDto, @Req() req: BookingEngineRequest) {
    return this.service.createPaymentMethodSetup(req.bookingEngine.propertyId, dto);
  }

  @Post('requests')
  @UseGuards(BookingThrottleGuardBridge)
  @ApiOperation({ summary: 'Submit a sellable stay for staff review' })
  @ApiResponse({ status: 201, description: 'Pending request acknowledgement' })
  submit(@Body() dto: SubmitBookingRequestDto, @Req() req: BookingEngineRequest) {
    return this.service.submit(req.bookingEngine.propertyId, dto);
  }
}
