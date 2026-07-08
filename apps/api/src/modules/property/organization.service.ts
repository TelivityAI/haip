import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class OrganizationService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async findAll() {
    return this.db.select().from(organizations);
  }
}
