import { IsIn, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MIGRATION_SOURCE_PMS } from '@telivityhaip/shared';

export class UpsertMigrationCredentialDto {
  @ApiProperty({ enum: MIGRATION_SOURCE_PMS, example: 'mews' })
  @IsIn([...MIGRATION_SOURCE_PMS])
  sourcePms!: (typeof MIGRATION_SOURCE_PMS)[number];

  @ApiProperty({
    description:
      'Source-PMS credential payload (API keys, tokens). Encrypted at rest; never returned by the API.',
    example: { clientToken: '***', accessToken: '***' },
  })
  @IsObject()
  credentials!: Record<string, unknown>;
}
