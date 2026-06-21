import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AuditActorCtx, type AuditActor } from '../../common/audit/audit-actor';
import { GuestService } from './guest.service';
import { CreateGuestDto } from './dto/create-guest.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';
import { SearchGuestsDto } from './dto/search-guests.dto';

@ApiTags('guests')
@Controller('guests')
export class GuestController {
  constructor(private readonly guestService: GuestService) {}

  // Guests are cross-property by design, but access MUST be scoped to a
  // property via the caller-supplied `propertyId` query param. The service
  // verifies the guest has ≥1 reservation at that property before returning
  // or mutating PII — otherwise staff at property A could enumerate/modify
  // guest records belonging to property B.
  @Get()
  @ApiOperation({ summary: 'Search and list guests at a property' })
  @ApiResponse({ status: 200, description: 'Paginated list of guests' })
  searchGuests(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() dto: SearchGuestsDto,
  ) {
    return this.guestService.search(propertyId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get guest by ID (scoped to property)' })
  @ApiResponse({ status: 200, description: 'Guest found' })
  @ApiResponse({ status: 404, description: 'Guest not found at this property' })
  getGuestById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.guestService.findById(id, propertyId);
  }

  @Post()
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Create new guest profile' })
  @ApiResponse({ status: 201, description: 'Guest created' })
  createGuest(@Body() dto: CreateGuestDto) {
    // Creation is intentionally NOT scoped by existing reservation — a new
    // walk-in/booking does not yet have one. The linking reservation is
    // created by the reservation flow immediately after.
    return this.guestService.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Update guest profile (scoped to property)' })
  @ApiResponse({ status: 200, description: 'Guest updated' })
  @ApiResponse({ status: 404, description: 'Guest not found at this property' })
  updateGuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateGuestDto,
  ) {
    return this.guestService.update(id, propertyId, dto);
  }

  @Delete(':id')
  @Roles('admin', 'front_desk')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Erase guest profile (GDPR right to erasure, scoped to property). Anonymizes PII and preserves booking history.' })
  @ApiResponse({ status: 204, description: 'Guest erased (anonymized)' })
  @ApiResponse({ status: 404, description: 'Guest not found at this property' })
  async deleteGuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @AuditActorCtx() actor: AuditActor,
  ): Promise<void> {
    await this.guestService.delete(id, propertyId, actor);
  }
}
