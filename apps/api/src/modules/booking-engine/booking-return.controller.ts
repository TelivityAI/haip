import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Redirect } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { BookingEngineService } from './booking-engine.service';

/**
 * Full-page provider navigation cannot supply x-booking-key. This isolated relay
 * is authorized by the limited opaque capability, paired with request tenant scope.
 * It only redirects to a previously validated and persisted page; it never finalizes payment.
 */
@ApiTags('Booking Engine — Guest-facing Direct Booking')
@Controller('booking-return')
@Public()
export class BookingReturnController {
  constructor(private readonly service: BookingEngineService) {}

  @Get(':reference')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect(undefined, 303)
  @ApiOperation({ summary: 'Return from hosted checkout to the bound embedding page' })
  @ApiParam({ name: 'reference', description: 'Opaque expiring return capability' })
  @ApiQuery({ name: 'propertyId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 303, description: 'Redirect to the previously validated embedding page' })
  @ApiResponse({ status: 404, description: 'Unknown, expired, invalid or out-of-scope return' })
  async resolve(
    @Param('reference') reference: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return { url: await this.service.resolvePaymentReturn(propertyId, reference) };
  }
}
