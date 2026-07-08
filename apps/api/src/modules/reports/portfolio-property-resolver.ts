import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { properties } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import type { AuthUser } from '../auth/current-user.decorator';
import { userCanAccessProperty } from '../auth/property-access';

@Injectable()
export class PortfolioPropertyResolver {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Resolve property IDs for portfolio-scoped operations. Filters to properties
   * the caller may access. When organizationId is provided, further restricts
   * to that org's properties.
   */
  async resolvePropertyIds(
    user: AuthUser | undefined,
    authEnabled: boolean,
    organizationId?: string,
    propertyIdsParam?: string[],
  ): Promise<string[]> {
    let rows = await this.db
      .select({ id: properties.id, organizationId: properties.organizationId })
      .from(properties)
      .where(eq(properties.isActive, true));

    if (organizationId) {
      rows = rows.filter((r: { organizationId: string | null }) => r.organizationId === organizationId);
    }

    if (propertyIdsParam?.length) {
      const allowed = new Set(propertyIdsParam);
      rows = rows.filter((r: { id: string }) => allowed.has(r.id));
    }

    if (authEnabled && user) {
      rows = rows.filter((r: { id: string }) => userCanAccessProperty(user, r.id));
    }

    const ids = rows.map((r: { id: string }) => r.id);
    if (!ids.length) {
      throw new BadRequestException('No accessible properties for portfolio scope');
    }
    return ids;
  }

  async findByOrganization(organizationId: string, user?: AuthUser, authEnabled = true) {
    const conditions = [
      eq(properties.isActive, true),
      eq(properties.organizationId, organizationId),
    ];
    const rows = await this.db
      .select()
      .from(properties)
      .where(and(...conditions));

    if (authEnabled && user) {
      return rows.filter((p: { id: string }) => userCanAccessProperty(user, p.id));
    }
    return rows;
  }
}
