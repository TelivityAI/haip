import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { BookingKeyGuard } from '../auth/booking-key.guard';
import { BookingEngineScopeGuard } from '../auth/booking-engine-scope.guard';
import { BookingThrottleGuard } from './booking-throttle.guard';
import { BookingEngineService } from './booking-engine.service';
import { BookingEngineConfigService } from './booking-engine-config.service';
import { BeSearchDto } from './dto/be-search.dto';
import { BeQuoteDto } from './dto/be-quote.dto';
import { BeCreateBookingDto } from './dto/be-create-booking.dto';
import { BeCancelDto } from './dto/be-cancel.dto';
import { PreRegisterDto } from '../reservation/dto/pre-register.dto';

/**
 * Public, guest-facing direct booking API — `/api/v1/booking-engine/*`.
 *
 * `@Public()` skips the Keycloak JWT guard; authentication is a PUBLISHABLE
 * booking key (`x-booking-key`) validated by `BookingKeyGuard`. The key is
 * property-scoped and low-trust (it ships in the hotel's website), so this
 * controller only exposes search / quote / book / read-or-cancel-own-confirmation.
 * `BookingEngineScopeGuard` enforces tenant isolation; `propertyId` is taken from
 * the credential, never from the client.
 */
@ApiTags('Booking Engine — Guest-facing Direct Booking')
@ApiSecurity('booking-key')
@Controller('booking-engine')
@Public()
@UseGuards(BookingKeyGuard, BookingEngineScopeGuard)
export class BookingEngineController {
  constructor(
    private readonly service: BookingEngineService,
    private readonly configService: BookingEngineConfigService,
  ) {}

  private propertyId(req: any): string {
    return req.bookingEngine.propertyId;
  }

  @Get('config')
  @ApiOperation({ summary: 'Public branding + deposit policy for the bound property' })
  async config(@Req() req: any) {
    return this.configService.getPublicConfig(this.propertyId(req));
  }

  @Get('services')
  @ApiOperation({ summary: 'List active extras sellable on the booking engine' })
  async listServices(@Req() req: any) {
    return this.service.listSellableServices(this.propertyId(req));
  }

  @Post('search')
  @ApiOperation({ summary: 'Search availability for publicly sellable rooms/rates' })
  @ApiResponse({ status: 200, description: 'Available room types and rates' })
  async search(@Body() dto: BeSearchDto, @Req() req: any) {
    return this.service.search(this.propertyId(req), dto);
  }

  @Post('quote')
  @ApiOperation({ summary: 'Firm price quote (with taxes + deposit due)' })
  async quote(@Body() dto: BeQuoteDto, @Req() req: any) {
    return this.service.quote(this.propertyId(req), dto);
  }

  @Post('book')
  @UseGuards(BookingThrottleGuard)
  @ApiOperation({ summary: 'Create a direct booking (guest + reservation + deposit payment)' })
  @ApiResponse({ status: 201, description: 'Booking confirmed with confirmation number' })
  async book(@Body() dto: BeCreateBookingDto, @Req() req: any) {
    return this.service.book(this.propertyId(req), dto);
  }

  @Get('bookings/:confirmationNumber')
  @ApiOperation({ summary: 'Retrieve a booking by confirmation number (guest self-service)' })
  async getBooking(@Param('confirmationNumber') confirmationNumber: string) {
    // Ownership is verified by BookingEngineScopeGuard before this runs.
    return this.service.verify(confirmationNumber);
  }

  @Delete('bookings/:confirmationNumber')
  @ApiOperation({ summary: 'Cancel a booking by confirmation number' })
  async cancel(
    @Param('confirmationNumber') confirmationNumber: string,
    @Body() dto: BeCancelDto,
    @Req() req: any,
  ) {
    return this.service.cancel(this.propertyId(req), confirmationNumber, dto.reason);
  }

  @Post('bookings/:confirmationNumber/pre-register')
  @ApiOperation({
    summary:
      'Advance check-in / pre-register — capture registration card and ID without checking in',
  })
  @ApiResponse({ status: 200, description: 'Registration fields saved; status unchanged' })
  async preRegister(
    @Param('confirmationNumber') confirmationNumber: string,
    @Body() dto: PreRegisterDto,
    @Req() req: any,
  ) {
    return this.service.preRegister(this.propertyId(req), confirmationNumber, dto);
  }
}
