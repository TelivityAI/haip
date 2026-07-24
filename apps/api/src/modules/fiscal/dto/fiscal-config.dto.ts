import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetFiscalConfigDto {
  @ApiPropertyOptional({
    description: 'Fiscal provider key for this property. Use null to disable.',
    example: 'serbia_suf_esir',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fiscalProviderKey?: string | null;

  @ApiPropertyOptional({
    description: 'Provider-specific fiscal configuration. Core does not interpret this object.',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  fiscalConfig?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Generic fiscal_documents.documentType value to store for provider acknowledgements.',
    example: 'mock',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentType?: string | null;

  @ApiPropertyOptional({
    description: 'Guest-registration provider key for this property. Use null to disable.',
    example: 'serbia_eturista',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guestRegistrationProviderKey?: string | null;

  @ApiPropertyOptional({
    description: 'Provider-specific guest-registration configuration. Core does not interpret this object.',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  guestRegistrationConfig?: Record<string, unknown>;
}
