import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
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
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsService } from '../auth/permissions.service';
import { PERMISSIONS, ALL_PERMISSIONS } from '../auth/permissions.catalog';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@ApiTags('admin')
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // ---- Permission catalog ----

  @Get('permissions')
  @RequirePermissions('admin.roles.manage')
  @ApiOperation({ summary: 'The code-defined permission catalog' })
  getCatalog() {
    return PERMISSIONS;
  }

  /**
   * Effective permissions for the CURRENT user — used by the dashboard to drive
   * nav/feature visibility. Any authenticated user may read their own. When
   * AUTH_ENABLED=false there is no JWT user, so the demo returns all permissions.
   */
  @Get('me/permissions')
  @Roles() // override class-level @Roles('admin'): any authenticated user
  @ApiOperation({ summary: 'Effective permissions for the current user' })
  async myPermissions(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @CurrentUser() authUser: AuthUser | undefined,
  ) {
    if (!authUser) {
      // Demo / auth-disabled: everything is permitted.
      return { permissions: ALL_PERMISSIONS, navKeys: navKeysFor(ALL_PERMISSIONS) };
    }
    const user = await this.permissionsService.findLocalUser(authUser.sub, authUser.email);
    const permissions = user
      ? await this.permissionsService.getEffectivePermissions(user.id, propertyId)
      : [];
    return { permissions, navKeys: navKeysFor(permissions) };
  }

  // ---- Users ----

  @Get('users')
  @RequirePermissions('admin.users.manage')
  @ApiOperation({ summary: 'List users at a property (with their roles)' })
  listUsers(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.usersService.list(propertyId);
  }

  @Post('users')
  @RequirePermissions('admin.users.manage')
  @ApiOperation({ summary: 'Create a local user' })
  @ApiResponse({ status: 201, description: 'User created' })
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch('users/:id')
  @RequirePermissions('admin.users.manage')
  @ApiOperation({ summary: 'Update a user (name / status)' })
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, propertyId, dto);
  }

  @Delete('users/:id')
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a user (soft delete)' })
  disableUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.usersService.disable(id, propertyId);
  }

  @Put('users/:id/roles')
  @RequirePermissions('admin.users.manage')
  @ApiOperation({ summary: 'Replace a user\'s role assignments at this property' })
  assignRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.usersService.assignRoles(id, propertyId, dto.roleIds);
  }

  @Get('users/:id/effective-permissions')
  @RequirePermissions('admin.users.manage')
  @ApiOperation({ summary: 'Resolved permission set for a user at this property' })
  userPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.usersService.effectivePermissions(id, propertyId);
  }

  // ---- Roles ----

  @Get('roles')
  @RequirePermissions('admin.roles.manage')
  @ApiOperation({ summary: 'List roles (system + custom) with their permissions' })
  listRoles(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.rolesService.list(propertyId);
  }

  @Post('roles')
  @RequirePermissions('admin.roles.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  createRole(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('admin.roles.manage')
  @ApiOperation({ summary: 'Update a custom role (system roles rejected)' })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(id, propertyId, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('admin.roles.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a custom role (system/assigned roles rejected)' })
  deleteRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.rolesService.delete(id, propertyId);
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('admin.roles.manage')
  @ApiOperation({ summary: 'Replace a custom role\'s permission grants' })
  setRolePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rolesService.setPermissions(id, propertyId, dto.permissionKeys);
  }
}

/** Map a set of granted permission keys to the dashboard routes they unlock. */
function navKeysFor(permissions: readonly string[]): string[] {
  const set = new Set(permissions);
  return PERMISSIONS.filter((p) => p.navKey && set.has(p.key)).map((p) => p.navKey as string);
}
