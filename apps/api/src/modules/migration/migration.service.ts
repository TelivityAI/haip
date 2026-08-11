import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  migrationJobs,
  migrationSourceCredentials,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { GuestService } from '../guest/guest.service';
import { RoomService } from '../room/room.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import { ReservationService } from '../reservation/reservation.service';
import { FolioService } from '../folio/folio.service';
import { MigrationIdMapService } from './migration-id-map.service';
import { MigrationCryptoService } from './migration-crypto.service';
import type {
  CreateMigrationJobDto,
  MigrationEntity,
} from './dto/create-migration-job.dto';

/**
 * Migration jobs (TEL-67) — durable, resumable, idempotent batch imports that
 * Remy drives during a PMS migration project.
 *
 * Design notes:
 * - Rows are staged on the job row itself (jsonb) so a worker can resume from
 *   `processedRows` after a crash/restart with no external state.
 * - Every row SHOULD carry `legacyId`. When it does, completion is recorded in
 *   `migration_legacy_id_map` and re-runs skip instead of duplicating — the
 *   "double approve" / "re-upload the same export" case becomes a safe no-op.
 * - Reference fields (roomTypeId, ratePlanId, guestId, reservationId) may be
 *   given as HAIP UUIDs or as `{ "legacyId": "<source id>" }`, resolved through
 *   the id map for the same project.
 * - Open folio balances are imported as a single `adjustment` opening-balance
 *   charge on a fresh guest folio — closed-period history is NEVER replayed.
 */

interface RowOutcome {
  index: number;
  legacyId?: string;
  status: 'created' | 'skipped' | 'failed' | 'validated';
  haipId?: string;
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly guestService: GuestService,
    private readonly roomService: RoomService,
    private readonly ratePlanService: RatePlanService,
    private readonly reservationService: ReservationService,
    private readonly folioService: FolioService,
    private readonly idMap: MigrationIdMapService,
    private readonly crypto: MigrationCryptoService,
  ) {}

  /** Create a job row. The caller enqueues processing (queue service). */
  async createJob(dto: CreateMigrationJobDto) {
    if (dto.rows.length > 50_000) {
      throw new BadRequestException(
        'A single migration job is limited to 50,000 rows — split the batch',
      );
    }
    const [job] = await this.db
      .insert(migrationJobs)
      .values({
        propertyId: dto.propertyId,
        projectRef: dto.projectRef,
        entity: dto.entity,
        rows: dto.rows,
        totalRows: dto.rows.length,
        dryRun: dto.dryRun ? 'true' : 'false',
      })
      .returning();
    return job;
  }

  async getJob(propertyId: string, jobId: string) {
    const [job] = await this.db
      .select()
      .from(migrationJobs)
      .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));
    if (!job) throw new NotFoundException(`Migration job ${jobId} not found`);
    return this.publicView(job);
  }

  async listJobs(propertyId: string, projectRef?: string) {
    const conditions = [eq(migrationJobs.propertyId, propertyId)];
    if (projectRef) conditions.push(eq(migrationJobs.projectRef, projectRef));
    const rows = await this.db
      .select()
      .from(migrationJobs)
      .where(and(...conditions))
      .orderBy(desc(migrationJobs.createdAt))
      .limit(100);
    return rows.map((j: any) => this.publicView(j));
  }

  async cancelJob(propertyId: string, jobId: string) {
    const job = await this.getJob(propertyId, jobId);
    if (job.status === 'completed' || job.status === 'completed_with_errors') {
      throw new BadRequestException(`Job ${jobId} already finished — nothing to cancel`);
    }
    await this.db
      .update(migrationJobs)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));
    return this.getJob(propertyId, jobId);
  }

  /**
   * Process a job from its checkpoint. Called by the queue worker (and directly
   * by tests). Chunks rows so the job row is periodically updated — a crash
   * mid-job resumes from the last committed chunk.
   */
  async processJob(jobId: string, propertyId: string): Promise<void> {
    const [job] = await this.db
      .select()
      .from(migrationJobs)
      .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));

    if (
      !job ||
      job.status === 'cancelled' ||
      job.status === 'completed' ||
      job.status === 'completed_with_errors'
    ) {
      return;
    }

    const dryRun = job.dryRun === 'true';
    const rows = job.rows as Record<string, unknown>[];
    const entity = job.entity as MigrationEntity;
    const known = await this.idMap.loadForEntity(propertyId, job.projectRef, entity);
    const errors: Array<{ index: number; legacyId?: string; error: string }> = Array.isArray(
      job.errors,
    )
      ? [...(job.errors as any[])]
      : [];

    await this.db
      .update(migrationJobs)
      .set({
        status: 'running',
        startedAt: job.startedAt ?? new Date(),
        attempts: (job.attempts ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));

    let created = job.createdCount ?? 0;
    let skipped = job.skippedCount ?? 0;
    let failed = job.failedCount ?? 0;
    let cursor = job.processedRows ?? 0;
    const CHUNK = 200;

    try {
      while (cursor < rows.length) {
        const chunk = rows.slice(cursor, cursor + CHUNK);
        for (let i = 0; i < chunk.length; i++) {
          const index = cursor + i;
          const outcome = await this.processRow({
            propertyId,
            projectRef: job.projectRef,
            entity,
            row: chunk[i]!,
            index,
            dryRun,
            known,
          });
          if (outcome.status === 'failed') {
            failed++;
            errors.push({ index, legacyId: outcome.legacyId, error: outcome.error! });
          } else if (outcome.status === 'skipped') {
            skipped++;
          } else {
            created++;
          }
        }
        cursor += chunk.length;
        await this.db
          .update(migrationJobs)
          .set({
            processedRows: cursor,
            createdCount: created,
            skippedCount: skipped,
            failedCount: failed,
            errors,
            updatedAt: new Date(),
          })
          .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));
      }

      const terminal = failed > 0 ? 'completed_with_errors' : 'completed';
      await this.db
        .update(migrationJobs)
        .set({ status: terminal, completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));
    } catch (err: any) {
      this.logger.error(`Migration job ${jobId} failed at row ${cursor}: ${err?.message ?? err}`);
      await this.db
        .update(migrationJobs)
        .set({
          status: 'pending', // back to pending so the worker retry resumes from checkpoint
          processedRows: cursor,
          createdCount: created,
          skippedCount: skipped,
          failedCount: failed,
          errors,
          lastError: err?.message ?? 'Unknown error',
          updatedAt: new Date(),
        })
        .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.propertyId, propertyId)));
      throw err; // let BullMQ schedule the retry
    }
  }

  private async processRow(ctx: {
    propertyId: string;
    projectRef: string;
    entity: MigrationEntity;
    row: Record<string, unknown>;
    index: number;
    dryRun: boolean;
    known: Map<string, string>;
  }): Promise<RowOutcome> {
    const { propertyId, projectRef, entity, row, index, dryRun, known } = ctx;
    const legacyId =
      typeof row['legacyId'] === 'string' && row['legacyId'].trim() !== ''
        ? row['legacyId'].trim()
        : undefined;

    try {
      if (legacyId && known.has(legacyId)) {
        return { index, legacyId, status: 'skipped', haipId: known.get(legacyId) };
      }
      const resolved = await this.resolveReferences(propertyId, projectRef, entity, row, dryRun);
      const dto = this.buildDto(entity, resolved, propertyId);
      if (dryRun) {
        return { index, legacyId, status: 'validated' };
      }
      const created = await this.persist(entity, dto);
      if (legacyId) {
        await this.idMap.record(propertyId, projectRef, entity, legacyId, created.id);
        known.set(legacyId, created.id);
      }
      return { index, legacyId, status: 'created', haipId: created.id };
    } catch (err: any) {
      return { index, legacyId, status: 'failed', error: err?.message ?? 'Unknown error' };
    }
  }

  /**
   * Replace `{ legacyId }` reference objects with HAIP uuids via the id map.
   * Passthrough when the value is already a UUID. In dry-run, unresolved
   * references are left undefined (validation covers required-field presence;
   * referential integrity is proven by the live run's per-row errors).
   */
  private async resolveReferences(
    propertyId: string,
    projectRef: string,
    entity: MigrationEntity,
    row: Record<string, unknown>,
    dryRun: boolean,
  ): Promise<Record<string, unknown>> {
    const refEntity: Record<string, MigrationEntity> = {
      guestId: 'guests',
      roomTypeId: 'room-types',
      ratePlanId: 'rate-plans',
      roomId: 'rooms',
      reservationId: 'reservations',
    };
    const out: Record<string, unknown> = { ...row };
    for (const field of Object.keys(refEntity)) {
      const v = out[field];
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        typeof (v as any).legacyId === 'string'
      ) {
        const resolved = await this.idMap.resolve(
          propertyId,
          projectRef,
          refEntity[field]!,
          (v as any).legacyId,
        );
        if (!resolved) {
          if (!dryRun) {
            throw new BadRequestException(
              `Unresolved ${field} legacyId "${(v as any).legacyId}" — import ${refEntity[field]} first`,
            );
          }
          out[field] = undefined;
        } else {
          out[field] = resolved;
        }
      }
    }
    return out;
  }

  /** Canonical row → create DTO per entity. Throws on invalid values. */
  private buildDto(
    entity: MigrationEntity,
    row: Record<string, unknown>,
    propertyId: string,
  ): Record<string, unknown> {
    const str = (k: string) => {
      const v = row[k];
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
    };
    const req = (k: string) => {
      const v = str(k);
      if (v === undefined) throw new BadRequestException(`Missing required field "${k}"`);
      return v;
    };
    const int = (k: string, required = false) => {
      const raw = row[k];
      if (raw === undefined || raw === null || raw === '') {
        if (required) throw new BadRequestException(`Missing required field "${k}"`);
        return undefined;
      }
      const n = Number(raw);
      if (!Number.isInteger(n)) {
        throw new BadRequestException(`Field "${k}" must be an integer (got "${String(raw)}")`);
      }
      return n;
    };
    const ref = (k: string, required = false) => {
      const v = row[k];
      if (v === undefined || v === null || v === '') {
        if (required) throw new BadRequestException(`Missing required field "${k}"`);
        return undefined;
      }
      if (typeof v !== 'string' || !UUID_RE.test(v)) {
        throw new BadRequestException(
          `Field "${k}" must be a HAIP uuid or { "legacyId": "..." }`,
        );
      }
      return v;
    };

    switch (entity) {
      case 'guests':
        return {
          firstName: req('firstName'),
          lastName: req('lastName'),
          email: str('email'),
          phone: str('phone'),
          companyName: str('companyName'),
          loyaltyNumber: str('loyaltyNumber'),
          nationality: str('nationality'),
        };
      case 'room-types':
        return {
          propertyId,
          name: req('name'),
          code: req('code'),
          description: str('description'),
          maxOccupancy: int('maxOccupancy', true),
          defaultOccupancy: int('defaultOccupancy', true),
          bedType: str('bedType'),
          bedCount: int('bedCount'),
        };
      case 'rooms':
        return {
          propertyId,
          roomTypeId: ref('roomTypeId', true),
          number: req('number'),
          floor: str('floor'),
          building: str('building'),
          isAccessible: row['isAccessible'] === true || row['isAccessible'] === 'true',
          amenities: Array.isArray(row['amenities']) ? row['amenities'] : undefined,
        };
      case 'rate-plans':
        return {
          propertyId,
          roomTypeId: ref('roomTypeId', true),
          name: req('name'),
          code: req('code'),
          type: req('type'),
          description: str('description'),
          baseAmount: req('baseAmount'),
          currencyCode: req('currencyCode'),
          mealPlan: str('mealPlan'),
        };
      case 'reservations':
        return {
          propertyId,
          guestId: ref('guestId', true),
          arrivalDate: req('arrivalDate'),
          departureDate: req('departureDate'),
          roomTypeId: ref('roomTypeId', true),
          ratePlanId: ref('ratePlanId', true),
          totalAmount: req('totalAmount'),
          currencyCode: req('currencyCode'),
          source: str('source') ?? 'direct',
          adults: int('adults'),
          children: int('children'),
          specialRequests: str('specialRequests'),
          channelCode: str('channelCode'),
          externalConfirmation: str('externalConfirmation') ?? str('legacyId'),
        };
      case 'folio-balances':
        return {
          propertyId,
          reservationId: ref('reservationId'),
          guestId: ref('guestId', true),
          amount: req('amount'),
          currencyCode: req('currencyCode'),
          note: str('note'),
        };
    }
  }

  private async persist(
    entity: MigrationEntity,
    dto: Record<string, unknown>,
  ): Promise<{ id: string }> {
    switch (entity) {
      case 'guests':
        return this.guestService.create(dto as any);
      case 'room-types':
        return this.roomService.createRoomType(dto as any);
      case 'rooms':
        return this.roomService.createRoom(dto as any);
      case 'rate-plans':
        return this.ratePlanService.create(dto as any);
      case 'reservations':
        return this.reservationService.create(dto as any);
      case 'folio-balances': {
        // Opening balance: fresh guest folio + a single adjustment charge.
        // Closed-period history is archived, never replayed into the ledger.
        const folio = await this.folioService.create({
          propertyId: dto['propertyId'],
          reservationId: dto['reservationId'],
          guestId: dto['guestId'],
          type: 'guest',
          currencyCode: dto['currencyCode'],
          notes: `Migration opening balance${dto['note'] ? ` — ${dto['note']}` : ''}`,
        } as any);
        const amount = Number(dto['amount']);
        if (amount > 0) {
          await this.folioService.postCharge(folio.id, {
            propertyId: dto['propertyId'],
            type: 'adjustment',
            description: 'Opening balance carried from previous PMS',
            amount: dto['amount'],
            currencyCode: dto['currencyCode'],
            serviceDate: new Date().toISOString().slice(0, 10),
            skipTaxCalculation: true,
          } as any);
        }
        return folio;
      }
    }
  }

  // ── Source credential vault (TEL-70) ──────────────────────────────────────

  async storeSourceCredential(
    propertyId: string,
    sourcePms: string,
    secret: string,
    createdBy?: string,
  ) {
    if (!this.crypto.isEnabled()) {
      throw new BadRequestException(
        'Credential storage is not configured on this environment (MIGRATION_CREDENTIAL_KEY missing)',
      );
    }
    const { ciphertext, keyId } = this.crypto.encrypt(secret);
    await this.db
      .insert(migrationSourceCredentials)
      .values({ propertyId, sourcePms, ciphertext, keyId, createdBy })
      .onConflictDoUpdate({
        target: [migrationSourceCredentials.propertyId, migrationSourceCredentials.sourcePms],
        set: { ciphertext, keyId, rotatedAt: new Date(), updatedAt: new Date() },
      });
    return { propertyId, sourcePms, stored: true };
  }

  /** Server-side only — the runner uses this to call the source PMS. Never exposed via API. */
  async readSourceCredential(propertyId: string, sourcePms: string): Promise<string | null> {
    const [row] = await this.db
      .select({ ciphertext: migrationSourceCredentials.ciphertext })
      .from(migrationSourceCredentials)
      .where(
        and(
          eq(migrationSourceCredentials.propertyId, propertyId),
          eq(migrationSourceCredentials.sourcePms, sourcePms),
        ),
      );
    if (!row) return null;
    return this.crypto.decrypt(row.ciphertext);
  }

  async deleteSourceCredential(propertyId: string, sourcePms: string) {
    await this.db
      .delete(migrationSourceCredentials)
      .where(
        and(
          eq(migrationSourceCredentials.propertyId, propertyId),
          eq(migrationSourceCredentials.sourcePms, sourcePms),
        ),
      );
    return { deleted: true };
  }

  /** Job view for API consumers — rows payload is large; expose counts + errors. */
  private publicView(job: any) {
    const { rows, ...rest } = job;
    return {
      ...rest,
      dryRun: job.dryRun === 'true',
      errors: Array.isArray(job.errors) ? (job.errors as unknown[]).slice(0, 500) : [],
      errorCount: Array.isArray(job.errors) ? (job.errors as unknown[]).length : 0,
    };
  }
}
