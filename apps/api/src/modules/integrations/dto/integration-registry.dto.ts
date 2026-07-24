import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export const INTEGRATION_CATALOG_STATUSES = ['shipped', 'recipe', 'adapter', 'planned'] as const;
export type IntegrationCatalogStatus = (typeof INTEGRATION_CATALOG_STATUSES)[number];

export class ListIntegrationsDto {
  @ApiPropertyOptional({
    description: 'Public catalog category from docs/INTEGRATIONS.md',
    example: 'Payments',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({
    enum: INTEGRATION_CATALOG_STATUSES,
    description: 'Public availability of the integration in HAIP',
  })
  @IsOptional()
  @IsIn(INTEGRATION_CATALOG_STATUSES)
  status?: IntegrationCatalogStatus;
}

export class IntegrationCatalogItemDto {
  @ApiProperty({ example: 'stripe' })
  slug!: string;

  @ApiProperty({ example: 'Payments' })
  category!: string;

  @ApiProperty({ example: 'Stripe' })
  name!: string;

  @ApiProperty({ enum: INTEGRATION_CATALOG_STATUSES })
  status!: IntegrationCatalogStatus;

  @ApiPropertyOptional({
    nullable: true,
    example: 'docs/INTEGRATIONS.md#payments',
  })
  docsPath!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'stripe' })
  adapterKey!: string | null;

  @ApiProperty({
    example:
      'Card payment integration for tokenized payments, payment intents, refunds, and transaction records.',
  })
  description!: string;
}

export class PropertyIntegrationItemDto extends IntegrationCatalogItemDto {
  @ApiProperty({ description: 'Whether this integration is enabled for the property' })
  enabled!: boolean;

  @ApiPropertyOptional({
    description: 'Property-specific configuration (adapter credentials, webhook URLs, etc.)',
    type: 'object',
    additionalProperties: true,
  })
  config!: Record<string, unknown>;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set when the property has a connection row for this catalog entry',
  })
  connectionId!: string | null;
}

export class UpsertPropertyIntegrationDto {
  @ApiProperty({ description: 'Enable or disable the integration for this property' })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    description: 'Replace property-specific configuration',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
