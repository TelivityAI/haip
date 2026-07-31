import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Declare which roles can access an endpoint.
 * If no @Roles() is set, any authenticated user can access.
 *
 * @example
 * @Roles('admin', 'general_manager', 'front_desk', 'reservations')
 * @Post()
 * create() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
