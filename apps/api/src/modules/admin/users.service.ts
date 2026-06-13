import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { and, eq, or, isNull, inArray } from 'drizzle-orm';
import { users, roles, userRoles, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { PermissionsService } from '../auth/permissions.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * UsersService — local user accounts (property-scoped).
 *
 * Every read/write is scoped by `propertyId`. Users are deactivated (status =
 * disabled), never hard-deleted, to preserve audit/assignment history.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly permissions: PermissionsService,
  ) {}

  /** Roles assignable at this property: system/global roles + property-local custom roles. */
  private rolesScopeWhere(propertyId: string) {
    return or(isNull(roles.propertyId), eq(roles.propertyId, propertyId));
  }

  async list(propertyId: string) {
    const userRows = await this.db
      .select()
      .from(users)
      .where(eq(users.propertyId, propertyId))
      .orderBy(users.name);

    const ids = userRows.map((u: { id: string }) => u.id);
    const roleRows = ids.length
      ? await this.db
          .select({
            userId: userRoles.userId,
            roleId: roles.id,
            roleKey: roles.key,
            roleName: roles.name,
          })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(and(eq(userRoles.propertyId, propertyId), inArray(userRoles.userId, ids)))
      : [];

    return userRows.map((u: { id: string }) => ({
      ...u,
      roles: roleRows
        .filter((r: { userId: string }) => r.userId === u.id)
        .map((r: { roleId: string; roleKey: string; roleName: string }) => ({
          id: r.roleId,
          key: r.roleKey,
          name: r.roleName,
        })),
    }));
  }

  private async getOwned(id: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.propertyId, propertyId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return row;
  }

  async create(dto: CreateUserDto) {
    const [dupe] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    if (dupe) {
      throw new ConflictException(`A user with email ${dto.email} already exists`);
    }
    if (dto.roleIds?.length) {
      await this.assertRolesExist(dto.roleIds, dto.propertyId);
    }

    return this.db.transaction(async (tx: any) => {
      const [user] = await tx
        .insert(users)
        .values({
          propertyId: dto.propertyId,
          email: dto.email,
          name: dto.name,
          status: dto.status ?? 'active',
          keycloakSub: dto.keycloakSub ?? null,
        })
        .returning();
      if (dto.roleIds?.length) {
        await tx.insert(userRoles).values(
          dto.roleIds.map((roleId) => ({
            propertyId: dto.propertyId,
            userId: user.id,
            roleId,
          })),
        );
      }
      await tx.insert(auditLogs).values({
        propertyId: dto.propertyId,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        description: 'user.created',
      });
      return user;
    });
  }

  async update(id: string, propertyId: string, dto: UpdateUserDto) {
    await this.getOwned(id, propertyId);
    const [user] = await this.db
      .update(users)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.propertyId, propertyId)))
      .returning();
    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'user',
      entityId: id,
      description: 'user.updated',
    });
    return user;
  }

  /** DELETE = soft-disable (preserves history). */
  async disable(id: string, propertyId: string) {
    await this.getOwned(id, propertyId);
    await this.db
      .update(users)
      .set({ status: 'disabled', updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.propertyId, propertyId)));
    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'user',
      entityId: id,
      description: 'user.disabled',
    });
    return { disabled: true };
  }

  private async assertRolesExist(roleIds: string[], propertyId: string) {
    const found = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, roleIds), this.rolesScopeWhere(propertyId)));
    if (found.length !== new Set(roleIds).size) {
      throw new BadRequestException('One or more roles do not exist at this property');
    }
  }

  async assignRoles(userId: string, propertyId: string, roleIds: string[]) {
    await this.getOwned(userId, propertyId);
    await this.assertRolesExist(roleIds, propertyId);
    await this.db.transaction(async (tx: any) => {
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.propertyId, propertyId)));
      if (roleIds.length) {
        await tx.insert(userRoles).values(
          roleIds.map((roleId) => ({ propertyId, userId, roleId })),
        );
      }
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'user',
        entityId: userId,
        description: 'user.roles_updated',
      });
    });
    return this.effectivePermissions(userId, propertyId);
  }

  async effectivePermissions(userId: string, propertyId: string) {
    await this.getOwned(userId, propertyId);
    const permissions = await this.permissions.getEffectivePermissions(userId, propertyId);
    return { userId, propertyId, permissions };
  }
}
