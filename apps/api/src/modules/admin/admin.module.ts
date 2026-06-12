import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';

/**
 * Admin module — local user/role/permission administration.
 * Imports AuthModule to reuse PermissionsService (effective-permission resolution).
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [UsersService, RolesService],
  exports: [UsersService, RolesService],
})
export class AdminModule {}
