import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Roles } from '../auth/roles.decorator';
import { PermissionsService } from '../auth/permissions.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { userCanAccessProperty } from '../auth/property-access';
import { AuditActorCtx, type AuditActor } from '../../common/audit/audit-actor';
import { PropertyService } from './property.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@ApiTags('properties')
@Controller('properties')
export class PropertyController {
  constructor(
    private readonly propertyService: PropertyService,
    private readonly configService: ConfigService,
    private readonly permissionsService: PermissionsService,
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
  // Settings writes are a property-admin action, not a global-admin one: the
  // class-free @RequirePermissions below would fall back to the `?propertyId=`
  // lookup, and this route carries the tenant in `:id`, so the check is explicit.
  // `@Roles()` is intentionally left empty to override nothing while keeping the
  // global roles guard permissive for property-scoped custom roles.
  @Roles()
  @ApiOperation({ summary: 'Update property' })
  @ApiResponse({ status: 200, description: 'Property updated' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  async updateProperty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() user?: AuthUser,
    @AuditActorCtx() actor?: AuditActor,
  ) {
    if (this.authOn()) {
      if (!user) throw new ForbiddenException('No authenticated user');
      if (!userCanAccessProperty(user, id)) {
        throw new ForbiddenException('You do not have access to this property');
      }
      await this.assertMayManageSettings(user, id, dto);
    }
    return this.propertyService.update(id, dto, actor);
  }

  /**
   * `settings.manage` for the `:id` property. PermissionsGuard resolves its
   * propertyId from the query/body, which this route does not carry, so the
   * permission is checked here against the path tenant instead of silently
   * skipping the requirement.
   */
  private async assertMayManageSettings(
    user: AuthUser,
    propertyId: string,
    dto: UpdatePropertyDto,
  ): Promise<void> {
    const propertyIdInBody = (dto as { propertyId?: unknown }).propertyId;
    if (propertyIdInBody !== undefined && propertyIdInBody !== propertyId) {
      throw new BadRequestException('propertyId in the body must match the property being updated');
    }
    const local = await this.permissionsService.findLocalUser(user.sub, user.email);
    if (!local) {
      throw new ForbiddenException('No local user account is linked to this login');
    }
    const permissions = await this.permissionsService.getEffectivePermissions(
      local.id,
      propertyId,
    );
    if (!permissions.includes('settings.manage')) {
      throw new ForbiddenException('Access denied. Required permission(s): settings.manage');
    }
  }
}
