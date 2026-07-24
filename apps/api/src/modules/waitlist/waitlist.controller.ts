import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import {
  CreateWaitlistEntryDto,
  ListWaitlistEntriesDto,
  OfferWaitlistEntryDto,
  UpdateWaitlistEntryDto,
} from './dto/waitlist.dto';
import { WaitlistService } from './waitlist.service';

@ApiTags('waitlist')
@Controller('waitlist-entries')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Create a waitlist entry without deducting inventory' })
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateWaitlistEntryDto) {
    return this.waitlistService.create(dto);
  }

  @Get()
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'List waitlist entries for a property' })
  list(@Query() dto: ListWaitlistEntriesDto) {
    return this.waitlistService.list(dto);
  }

  @Patch(':id')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Update an active/offered waitlist entry' })
  @ApiQuery({ name: 'propertyId', required: true })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateWaitlistEntryDto,
  ) {
    return this.waitlistService.update(id, propertyId, dto);
  }

  @Post(':id/offer')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Mark a waitlist entry as offered' })
  @ApiQuery({ name: 'propertyId', required: true })
  offer(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: OfferWaitlistEntryDto,
  ) {
    return this.waitlistService.offer(id, propertyId, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Cancel a waitlist entry' })
  @ApiQuery({ name: 'propertyId', required: true })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.waitlistService.cancel(id, propertyId);
  }

  @Post(':id/convert')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Convert a waitlist entry after an availability check' })
  @ApiQuery({ name: 'propertyId', required: true })
  convert(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.waitlistService.convert(id, propertyId);
  }
}
