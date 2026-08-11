import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { migrationJobs, migrationRowResults } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';
import { MigrationStepProcessorService } from './migration-step-processor.service';

const SUPPORTED_ENTITIES = new Set([
  'guests',
  'room-types',
  'rate-plans',
  'rooms',
  'open-folio-balances',
  'reservations',
]);

@Injectable()
export class MigrationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly stepProcessor: MigrationStepProcessorService,
  ) {}

  async createJob(propertyId: string, dto: CreateMigrationJobDto) {
    if (!SUPPORTED_ENTITIES.has(dto.entity)) {
      throw new BadRequestException(
        `Unknown migration entity "${dto.entity}". Supported: ${[...SUPPORTED_ENTITIES].join(', ')}`,
      );
    }

    const payload = this.buildPayload(dto);
    const totalRows = this.countRows(dto.entity, payload);

    const [job] = await this.db
      .insert(migrationJobs)
      .values({
        propertyId,
        projectId: dto.projectId,
        entity: dto.entity,
        dryRun: dto.dryRun ?? false,
        payload,
        totalRows,
        status: 'pending',
      })
      .returning();

    await this.stepProcessor.enqueueStep(job.id, propertyId);

    return job;
  }

  async getJob(id: string, propertyId: string) {
    const job = await this.findJob(id, propertyId);
    const rowResults = await this.db
      .select()
      .from(migrationRowResults)
      .where(
        and(
          eq(migrationRowResults.jobId, id),
          eq(migrationRowResults.propertyId, propertyId),
        ),
      )
      .orderBy(migrationRowResults.rowIndex);
    return { ...job, rowResults };
  }

  async resumeJob(id: string, propertyId: string) {
    const job = await this.findJob(id, propertyId);
    if (job.status === 'completed') {
      throw new BadRequestException('Job is already completed');
    }
    if (job.status === 'running') {
      throw new BadRequestException('Job is already running');
    }

    const [updated] = await this.db
      .update(migrationJobs)
      .set({ status: 'pending', lastError: null, updatedAt: new Date() })
      .where(and(eq(migrationJobs.id, id), eq(migrationJobs.propertyId, propertyId)))
      .returning();

    await this.stepProcessor.enqueueStep(id, propertyId);
    return updated;
  }

  private async findJob(id: string, propertyId: string) {
    const [job] = await this.db
      .select()
      .from(migrationJobs)
      .where(and(eq(migrationJobs.id, id), eq(migrationJobs.propertyId, propertyId)));
    if (!job) {
      throw new NotFoundException(`Migration job ${id} not found`);
    }
    return job;
  }

  private buildPayload(dto: CreateMigrationJobDto) {
    if (dto.entity === 'reservations') {
      if (!dto.reservations?.length) {
        throw new BadRequestException('reservations array is required for entity=reservations');
      }
      return { reservations: dto.reservations };
    }
    if (!dto.rows?.length) {
      throw new BadRequestException('rows array is required for generic import entities');
    }
    return { rows: dto.rows, mapping: dto.mapping };
  }

  private countRows(entity: string, payload: { rows?: unknown[]; reservations?: unknown[] }) {
    if (entity === 'reservations') {
      return payload.reservations?.length ?? 0;
    }
    return payload.rows?.length ?? 0;
  }
}
