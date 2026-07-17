import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsUrl,
  IsObject,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestFiscalDocumentDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({
    example: 'nfse',
    description:
      'Regional document type identifier (e.g. "nfse", "invoice"). Core does not interpret this value.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  documentType!: string;

  @ApiPropertyOptional({ description: 'Regional extras passed through to the issuing integration' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class IssueFiscalDocumentDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: '2026-000123', description: 'Official document number assigned by the issuer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  documentNumber!: string;

  @ApiPropertyOptional({ description: 'Link to the official document (PDF/XML) at the issuer' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  documentUrl?: string;

  @ApiPropertyOptional({ description: 'Issuance timestamp (defaults to now)' })
  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @ApiPropertyOptional({ description: 'Regional extras (series, verification code, ...)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class VoidFiscalDocumentDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Reason for voiding the document' })
  @IsOptional()
  @IsString()
  reason?: string;
}
