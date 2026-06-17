import { Injectable, BadRequestException } from '@nestjs/common';
import { GuestService } from '../guest/guest.service';
import { RoomService } from '../room/room.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import { parseCsv, applyMapping } from './csv.util';

/**
 * Generic, extensible data-import framework — the migration on-ramp for hotels
 * switching from another PMS. Accepts CSV text (or pre-parsed rows) + an optional
 * header→field mapping, validates per-row, and on commit creates each entity via
 * the EXISTING create services (no new domain logic). Per-row error reporting: a
 * single bad row never aborts the batch. A dry run validates without writing.
 *
 * To add an entity: register an importer in `this.importers` with its required
 * columns, a row→DTO builder, and the create call. Everything else (CSV parsing,
 * mapping, dry-run, manifest) is shared.
 */

export interface RowResult {
  index: number;
  success: boolean;
  id?: string;
  error?: string;
}

export interface ImportResult {
  entity: string;
  dryRun: boolean;
  total: number;
  created: number;
  failed: number;
  results: RowResult[];
}

interface Importer {
  /** Canonical columns that must be present and non-empty on every row. */
  required: string[];
  /** All canonical columns (for the downloadable template). */
  columns: string[];
  /** Build the create-DTO from a (mapped) row. Throws on invalid values.
   *  Row is `any` so builders can use dot access on the dynamic CSV columns. */
  build: (row: any, propertyId: string) => any;
  /** Persist one row. Returns the created entity's id. */
  create: (dto: any) => Promise<{ id: string }>;
}

@Injectable()
export class ImportService {
  private readonly importers: Record<string, Importer>;

  constructor(
    private readonly guestService: GuestService,
    private readonly roomService: RoomService,
    private readonly ratePlanService: RatePlanService,
  ) {
    this.importers = {
      guests: {
        required: ['firstName', 'lastName'],
        columns: ['firstName', 'lastName', 'email', 'phone', 'companyName', 'loyaltyNumber'],
        build: (row) => ({
          firstName: row.firstName,
          lastName: row.lastName,
          email: orUndefined(row.email),
          phone: orUndefined(row.phone),
          companyName: orUndefined(row.companyName),
          loyaltyNumber: orUndefined(row.loyaltyNumber),
        }),
        create: (dto) => this.guestService.create(dto),
      },
      'room-types': {
        required: ['name', 'code', 'maxOccupancy', 'defaultOccupancy'],
        columns: ['name', 'code', 'description', 'maxOccupancy', 'defaultOccupancy', 'bedType', 'bedCount'],
        build: (row, propertyId) => ({
          propertyId,
          name: row.name,
          code: row.code,
          description: orUndefined(row.description),
          maxOccupancy: toInt(row.maxOccupancy, 'maxOccupancy'),
          defaultOccupancy: toInt(row.defaultOccupancy, 'defaultOccupancy'),
          bedType: orUndefined(row.bedType),
          bedCount: row.bedCount ? toInt(row.bedCount, 'bedCount') : undefined,
        }),
        create: (dto) => this.roomService.createRoomType(dto),
      },
      'rate-plans': {
        required: ['roomTypeId', 'name', 'code', 'type', 'baseAmount', 'currencyCode'],
        columns: ['roomTypeId', 'name', 'code', 'description', 'type', 'baseAmount', 'currencyCode', 'mealPlan'],
        build: (row, propertyId) => ({
          propertyId,
          roomTypeId: row.roomTypeId,
          name: row.name,
          code: row.code,
          description: orUndefined(row.description),
          type: row.type,
          baseAmount: row.baseAmount,
          currencyCode: row.currencyCode,
          mealPlan: orUndefined(row.mealPlan),
        }),
        create: (dto) => this.ratePlanService.create(dto),
      },
    };
  }

  /** Entities available for import + their template columns. */
  listEntities() {
    return Object.entries(this.importers).map(([entity, imp]) => ({
      entity,
      columns: imp.columns,
      required: imp.required,
    }));
  }

  /** A downloadable CSV header template for an entity. */
  template(entity: string): string {
    const imp = this.requireImporter(entity);
    return imp.columns.join(',') + '\n';
  }

  async run(
    propertyId: string,
    entity: string,
    input: { csv?: string; rows?: Record<string, string>[]; mapping?: Record<string, string>; dryRun?: boolean },
  ): Promise<ImportResult> {
    const imp = this.requireImporter(entity);
    const dryRun = input.dryRun ?? false;

    const rawRows = input.csv ? parseCsv(input.csv) : input.rows ?? [];
    if (rawRows.length === 0) {
      throw new BadRequestException('No rows to import (provide `csv` text or `rows`)');
    }

    const results: RowResult[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const mapped = applyMapping(rawRows[i]!, input.mapping);
      try {
        // Validate required columns.
        for (const col of imp.required) {
          if (!mapped[col] || mapped[col]!.trim() === '') {
            throw new BadRequestException(`Missing required field "${col}"`);
          }
        }
        const dto = imp.build(mapped, propertyId);
        if (dryRun) {
          results.push({ index: i, success: true });
        } else {
          const created = await imp.create(dto);
          results.push({ index: i, success: true, id: created.id });
        }
      } catch (err: any) {
        results.push({ index: i, success: false, error: err?.message ?? 'Unknown error' });
      }
    }

    return {
      entity,
      dryRun,
      total: results.length,
      created: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  private requireImporter(entity: string): Importer {
    const imp = this.importers[entity];
    if (!imp) {
      throw new BadRequestException(
        `Unknown import entity "${entity}". Available: ${Object.keys(this.importers).join(', ')}`,
      );
    }
    return imp;
  }
}

function orUndefined(v: string | undefined): string | undefined {
  return v && v.trim() !== '' ? v.trim() : undefined;
}

function toInt(v: string, field: string): number {
  const n = Number(v);
  if (!Number.isInteger(n)) {
    throw new BadRequestException(`Field "${field}" must be an integer (got "${v}")`);
  }
  return n;
}
