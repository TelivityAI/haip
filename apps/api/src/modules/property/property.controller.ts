import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { userCanAccessProperty } from '../auth/property-access';
import { PropertyService } from './property.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@ApiTags('properties')
@Controller('properties')
export class PropertyController {
  constructor(
    private readonly propertyService: PropertyService,
    private readonly configService: ConfigService,
  ) {}

  private authOn(): boolean {
    return this.configService.get<string>('AUTH_ENABLED', 'true') !== 'false';
  }

  @Get()
  @ApiOperation({ summary: 'Get all active properties' })
  @ApiResponse({ status: 200, description: 'List of properties' })
  async getAllProperties(@CurrentUser() user?: AuthUser) {
    const all = await this.propertyService.findAll();
    // The `properties` row IS the tenant, so the global PropertyScopeGuard can't
    // bind it (the id param is `:id`, not `propertyId`). Scope the list to the
    // caller's memberships here; demo (auth off) returns everything.
    if (!this.authOn() || !user) return all;
    return all.filter((p) => userCanAccessProperty(user, p.id));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get property by ID' })
  @ApiResponse({ status: 200, description: 'Property found' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  getPropertyById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    if (this.authOn() && user && !userCanAccessProperty(user, id)) {
      throw new ForbiddenException('You do not have access to this property');
    }
    return this.propertyService.findById(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create new property' })
  @ApiResponse({ status: 201, description: 'Property created' })
  createProperty(@Body() dto: CreatePropertyDto) {
    return this.propertyService.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update property' })
  @ApiResponse({ status: 200, description: 'Property updated' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  updateProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.propertyService.update(id, dto);
  }
}
