import {
  IsArray,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MIGRATION_ENTITIES = [
  'guests',
  'room-types',
  'rooms',
  'rate-plans',
  'reservations',
  'folio-balances',
] as const;
export type MigrationEntity = (typeof MIGRATION_ENTITIES)[number];

/**
 * One migration job = one entity batch inside a wider migration project.
 * `projectRef` scopes idempotency + the legacy id map; rows carry
 * `legacyId` so re-runs skip instead of duplicating.
 */
export class CreateMigrationJobDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({
    description: 'External migration project reference (Remy project id or manual run label)',
  })
  @IsString()
  @MaxLength(120)
  projectRef!: string;

  @ApiProperty({ enum: MIGRATION_ENTITIES })
  @IsIn(MIGRATION_ENTITIES)
  entity!: MigrationEntity;

  @ApiProperty({
    type: [Object],
    description:
      'Canonical rows for the entity. Every row SHOULD carry `legacyId`; reference fields may use `{ "legacyId": ... }` in place of HAIP UUIDs.',
  })
  @IsArray()
  @ArrayMinSize(1)
  rows!: Record<string, unknown>[];

  @ApiPropertyOptional({ default: false, description: 'Validate only — process without writing' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
