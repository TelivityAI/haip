import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { and, eq, or, isNull, inArray } from 'drizzle-orm';
import { roles, rolePermissions, userRoles, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { isPermissionKey } from '../auth/permissions.catalog';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

/**
 * RolesService — DB-managed roles and their permission grants.
 *
 * System roles (isSystem, propertyId null) are read-only: they can't be
 * renamed, deleted, or re-permissioned. Custom roles are property-scoped and
 * fully editable. Permission keys are validated against the code catalog.
 */
@Injectable()
export class RolesService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async list(propertyId: string) {
    const roleRows = await this.db
      .select()
      .from(roles)
      .where(or(isNull(roles.propertyId), eq(roles.propertyId, propertyId)))
      .orderBy(roles.name);

    const ids = roleRows.map((r: { id: string }) => r.id);
    const permRows = ids.length
      ? await this.db
          .select({ roleId: rolePermissions.roleId, permissionKey: rolePermissions.permissionKey })
          .from(rolePermissions)
          .where(and(eq(rolePermissions.propertyId, propertyId), inArray(rolePermissions.roleId, ids)))
      : [];

    return roleRows.map((r: { id: string }) => ({
      ...r,
      permissions: permRows
        .filter((p: { roleId: string }) => p.roleId === r.id)
        .map((p: { permissionKey: string }) => p.permissionKey),
    }));
  }

  /** Custom role at this property (system roles are intentionally not matched). */
  private async getCustomRole(id: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.propertyId, propertyId)))
      .limit(1);
    if (!row) {
      // Either it doesn't exist, or it's a system role (propertyId null) — both
      // are not editable through this path.
      throw new NotFoundException(`Editable role ${id} not found at this property`);
    }
    if (row.isSystem) {
      throw new BadRequestException('System roles cannot be modified');
    }
    return row;
  }

  async create(dto: CreateRoleDto, actor?: AuditActor) {
    const [dupe] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.propertyId, dto.propertyId), eq(roles.key, dto.key)))
      .limit(1);
    if (dupe) {
      throw new ConflictException(`A role with key "${dto.key}" already exists`);
    }
    const [role] = await this.db
      .insert(roles)
      .values({
        propertyId: dto.propertyId,
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
      })
      .returning();
    await this.db.insert(auditLogs).values({
      propertyId: dto.propertyId,
      action: 'create',
      entityType: 'role',
      entityId: role.id,
      description: 'role.created',
      ...actorFields(actor),
    });
    return { ...role, permissions: [] };
  }

  async update(id: string, propertyId: string, dto: UpdateRoleDto, actor?: AuditActor) {
    await this.getCustomRole(id, propertyId);
    const [role] = await this.db
      .update(roles)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(roles.id, id), eq(roles.propertyId, propertyId)))
      .returning();
    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'role',
      entityId: id,
      description: 'role.updated',
      ...actorFields(actor),
    });
    return role;
  }

  async delete(id: string, propertyId: string, actor?: AuditActor) {
    await this.getCustomRole(id, propertyId);
    const [assigned] = await this.db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.roleId, id), eq(userRoles.propertyId, propertyId)))
      .limit(1);
    if (assigned) {
      throw new ConflictException('Role is assigned to users; unassign it first');
    }
    await this.db.transaction(async (tx: any) => {
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, id), eq(rolePermissions.propertyId, propertyId)));
      await tx.delete(roles).where(and(eq(roles.id, id), eq(roles.propertyId, propertyId)));
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'delete',
        entityType: 'role',
        entityId: id,
        description: 'role.deleted',
        ...actorFields(actor),
      });
    });
    return { deleted: true };
  }

  async setPermissions(id: string, propertyId: string, permissionKeys: string[], actor?: AuditActor) {
    await this.getCustomRole(id, propertyId);
    const invalid = permissionKeys.filter((k) => !isPermissionKey(k));
    if (invalid.length) {
      throw new BadRequestException(`Unknown permission key(s): ${invalid.join(', ')}`);
    }
    const unique = [...new Set(permissionKeys)];
    await this.db.transaction(async (tx: any) => {
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, id), eq(rolePermissions.propertyId, propertyId)));
      if (unique.length) {
        await tx.insert(rolePermissions).values(
          unique.map((permissionKey) => ({ propertyId, roleId: id, permissionKey })),
        );
      }
      await tx.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'role',
        entityId: id,
        description: 'role.permissions_updated',
        ...actorFields(actor),
      });
    });
    return { roleId: id, permissions: unique };
  }
}
