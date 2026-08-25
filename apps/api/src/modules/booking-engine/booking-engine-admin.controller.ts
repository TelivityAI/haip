import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { BookingEngineConfigService } from './booking-engine-config.service';
import { CreateBookingKeyDto, UpdateBookingEngineConfigDto } from './dto/be-admin.dto';

/**
 * Staff-facing booking-engine administration — `/api/v1/admin/booking-engine/*`.
 *
 * Keycloak-gated (NOT public): uses the normal dashboard auth (`@Roles` +
 * `@RequirePermissions('bookingengine.manage')`). `propertyId` is a required,
 * UUID-validated query param on every route (multi-tenancy). This is where an
 * operator generates publishable keys and configures sellable inventory, branding
 * and deposit policy — distinct from the public `BookingEngineController`.
 */
@ApiTags('admin')
@Controller('admin/booking-engine')
@Roles('admin')
export class BookingEngineAdminController {
  constructor(private readonly configService: BookingEngineConfigService) {}

  @Get('config')
  @RequirePermissions('bookingengine.manage')
  @ApiOperation({ summary: 'Get the booking-engine config for a property' })
  getConfig(@Query('propertyId', new ParseUUIDPipe()) propertyId: string) {
    return this.configService.getAdminConfig(propertyId);
  }

  @Patch('config')
  @RequirePermissions('bookingengine.manage')
  @ApiOperation({ summary: 'Update the booking-engine config (branding / inventory / deposit policy)' })
  @ApiHeader({
    name: 'If-Match',
    required: false,
    description: 'Strong ETag containing the updatedAt value from the last admin config read',
  })
  updateConfig(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: UpdateBookingEngineConfigDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.configService.updateConfig(propertyId, dto, parseConfigVersion(ifMatch));
  }

  @Get('keys')
  @RequirePermissions('bookingengine.manage')
  @ApiOperation({ summary: 'List publishable booking keys (hashes only — raw never returned)' })
  listKeys(@Query('propertyId', new ParseUUIDPipe()) propertyId: string) {
    return this.configService.listKeys(propertyId);
  }

  @Post('keys')
  @RequirePermissions('bookingengine.manage')
  @ApiOperation({ summary: 'Generate a publishable booking key (raw key returned ONCE)' })
  createKey(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: CreateBookingKeyDto,
  ) {
    return this.configService.createKey(propertyId, dto.label);
  }

  @Delete('keys/:id')
  @RequirePermissions('bookingengine.manage')
  @ApiOperation({ summary: 'Revoke a publishable booking key' })
  revokeKey(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.configService.revokeKey(propertyId, id);
  }
}

function parseConfigVersion(ifMatch?: string): string | undefined {
  if (ifMatch === undefined) return undefined;
  const match = /^"([^"\\]+)"$/.exec(ifMatch.trim());
  if (!match) {
    throw new BadRequestException('If-Match must be a single strong quoted config version');
  }
  const value = match[1]!;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new BadRequestException('If-Match must contain an ISO config version');
  }
  return value;
}
