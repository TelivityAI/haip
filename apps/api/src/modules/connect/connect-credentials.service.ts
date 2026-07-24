import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { auditLogs, connectCredentials } from '@telivityhaip/database';
import { actorFields, type AuditActor } from '../../common/audit/audit-actor';
import { DRIZZLE } from '../../database/database.module';
import { hashConnectKey } from '../auth/api-key.guard';
import type { CreateConnectCredentialDto } from './dto/connect-credential.dto';

export interface ConnectCredentialMetadata {
  id: string;
  name: string;
  propertyId: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revoked: boolean;
}

function generateConnectKey(): string {
  return `ck_live_${randomBytes(32).toString('base64url')}`;
}

@Injectable()
export class ConnectCredentialsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  private toMetadata(row: any): ConnectCredentialMetadata {
    return {
      id: row.id,
      name: row.label,
      propertyId: row.propertyId,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? null,
      revoked: row.isActive === false || row.revokedAt != null,
    };
  }

  async list(propertyId: string): Promise<ConnectCredentialMetadata[]> {
    const rows = await this.db
      .select({
        id: connectCredentials.id,
        label: connectCredentials.label,
        propertyId: connectCredentials.propertyId,
        scopes: connectCredentials.scopes,
        isActive: connectCredentials.isActive,
        lastUsedAt: connectCredentials.lastUsedAt,
        createdAt: connectCredentials.createdAt,
        revokedAt: connectCredentials.revokedAt,
      })
      .from(connectCredentials)
      .where(eq(connectCredentials.propertyId, propertyId))
      .orderBy(desc(connectCredentials.createdAt));

    return rows.map((row: any) => this.toMetadata(row));
  }

  async create(
    propertyId: string,
    dto: CreateConnectCredentialDto,
    actor?: AuditActor,
  ): Promise<ConnectCredentialMetadata & { key: string }> {
    const key = generateConnectKey();
    const [row] = await this.db
      .insert(connectCredentials)
      .values({
        propertyId,
        label: dto.name,
        scopes: dto.scopes ?? [],
        keyHash: hashConnectKey(key),
      })
      .returning({
        id: connectCredentials.id,
        label: connectCredentials.label,
        propertyId: connectCredentials.propertyId,
        scopes: connectCredentials.scopes,
        isActive: connectCredentials.isActive,
        lastUsedAt: connectCredentials.lastUsedAt,
        createdAt: connectCredentials.createdAt,
        revokedAt: connectCredentials.revokedAt,
      });

    const metadata = this.toMetadata(row);
    await this.audit('create', propertyId, row.id, 'connect_credential.created', metadata, actor);
    return { ...metadata, key };
  }

  async rotate(
    id: string,
    propertyId: string,
    actor?: AuditActor,
  ): Promise<ConnectCredentialMetadata & { key: string }> {
    const [existing] = await this.db
      .select({
        id: connectCredentials.id,
        isActive: connectCredentials.isActive,
        revokedAt: connectCredentials.revokedAt,
      })
      .from(connectCredentials)
      .where(and(eq(connectCredentials.id, id), eq(connectCredentials.propertyId, propertyId)))
      .limit(1);
    if (!existing) {
      throw new NotFoundException(`Connect credential ${id} not found`);
    }
    if (existing.isActive === false || existing.revokedAt != null) {
      throw new BadRequestException('Revoked credentials cannot be rotated');
    }

    const key = generateConnectKey();
    const [row] = await this.db
      .update(connectCredentials)
      .set({ keyHash: hashConnectKey(key) })
      .where(and(eq(connectCredentials.id, id), eq(connectCredentials.propertyId, propertyId)))
      .returning({
        id: connectCredentials.id,
        label: connectCredentials.label,
        propertyId: connectCredentials.propertyId,
        scopes: connectCredentials.scopes,
        isActive: connectCredentials.isActive,
        lastUsedAt: connectCredentials.lastUsedAt,
        createdAt: connectCredentials.createdAt,
        revokedAt: connectCredentials.revokedAt,
      });

    const metadata = this.toMetadata(row);
    await this.audit('update', propertyId, id, 'connect_credential.rotated', metadata, actor);
    return { ...metadata, key };
  }

  async revoke(id: string, propertyId: string, actor?: AuditActor) {
    const [row] = await this.db
      .update(connectCredentials)
      .set({ isActive: false, revokedAt: new Date() })
      .where(and(eq(connectCredentials.id, id), eq(connectCredentials.propertyId, propertyId)))
      .returning({
        id: connectCredentials.id,
        label: connectCredentials.label,
        propertyId: connectCredentials.propertyId,
        scopes: connectCredentials.scopes,
        isActive: connectCredentials.isActive,
        lastUsedAt: connectCredentials.lastUsedAt,
        createdAt: connectCredentials.createdAt,
        revokedAt: connectCredentials.revokedAt,
      });

    if (!row) {
      throw new NotFoundException(`Connect credential ${id} not found`);
    }

    const metadata = this.toMetadata(row);
    await this.audit('delete', propertyId, id, 'connect_credential.revoked', metadata, actor);
    return { revoked: true, id };
  }

  private async audit(
    action: 'create' | 'update' | 'delete',
    propertyId: string,
    entityId: string,
    description: string,
    newValue: ConnectCredentialMetadata,
    actor?: AuditActor,
  ) {
    await this.db.insert(auditLogs).values({
      propertyId,
      action,
      entityType: 'connect_credential',
      entityId,
      description,
      newValue,
      ...actorFields(actor),
    });
  }
}
