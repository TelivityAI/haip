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
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { userCanAccessProperty } from '../auth/property-access.util';
import { PropertyService } from './property.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@ApiTags('properties')
@Controller('properties')
export class PropertyController {
  constructor(private readonly propertyService: PropertyService) {}

  // The `properties` routes carry no `propertyId` param (the `:id` IS the tenant),
  // so PropertyAccessGuard can't scope them — membership is enforced here instead.
  // When auth is disabled (demo) there is no user, so everything is visible.
  @Get()
  @ApiOperation({ summary: 'Get all active properties' })
  @ApiResponse({ status: 200, description: 'List of properties' })
  async getAllProperties(@CurrentUser() user?: AuthUser) {
    const all = await this.propertyService.findAll();
    if (!user) return all; // auth disabled — nothing to scope by
    return all.filter((p: { id: string }) => userCanAccessProperty(user, p.id));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get property by ID' })
  @ApiResponse({ status: 200, description: 'Property found' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  getPropertyById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    if (user && !userCanAccessProperty(user, id)) {
      throw new ForbiddenException('Not a member of this property');
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
    @CurrentUser() user?: AuthUser,
  ) {
    // `:id` is the tenant, so the guard can't scope this — check membership here.
    if (user && !userCanAccessProperty(user, id)) {
      throw new ForbiddenException('Not a member of this property');
    }
    return this.propertyService.update(id, dto);
  }
}
