import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BookingEngineScopeGuard } from '../auth/booking-engine-scope.guard';
import { BookingKeyGuard } from '../auth/booking-key.guard';
import { Public } from '../auth/public.decorator';
import { BookingThrottleGuard } from '../booking-engine/booking-throttle.guard';
import { BookingRequestService } from './booking-request.service';
// DTO classes must remain runtime imports for Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateRequestCardSetupDto } from './dto/create-request-card-setup.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SubmitBookingRequestDto } from './dto/submit-booking-request.dto';

type BookingEngineRequest = {
  bookingEngine: { propertyId: string };
};

@ApiTags('Booking Engine — Booking Requests')
@ApiSecurity('booking-key')
@Controller('booking-engine')
@Public()
@UseGuards(BookingKeyGuard, BookingEngineScopeGuard)
export class BookingRequestPublicController {
  constructor(
    @Inject(BookingRequestService) private readonly service: BookingRequestService,
  ) {}

  @Post('request-payment-method-setup')
  @UseGuards(BookingThrottleGuard)
  @ApiOperation({ summary: 'Prepare optional or required request card collection' })
  @ApiResponse({ status: 201, description: 'SetupIntent client details' })
  createSetup(@Body() dto: CreateRequestCardSetupDto, @Req() req: BookingEngineRequest) {
    return this.service.createPaymentMethodSetup(req.bookingEngine.propertyId, dto);
  }

  @Post('requests')
  @UseGuards(BookingThrottleGuard)
  @ApiOperation({ summary: 'Submit a sellable stay for staff review' })
  @ApiResponse({ status: 201, description: 'Pending request acknowledgement' })
  submit(@Body() dto: SubmitBookingRequestDto, @Req() req: BookingEngineRequest) {
    return this.service.submit(req.bookingEngine.propertyId, dto);
  }
}
