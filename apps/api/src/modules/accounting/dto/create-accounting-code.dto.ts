import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAccountingCodeDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ enum: ['transaction', 'gl'], description: 'Code kind (KB 5)' })
  @IsEnum(['transaction', 'gl'])
  kind!: string;

  @ApiProperty({ example: 'ROOM-REV', description: 'Code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Room Revenue', description: 'Human-readable label' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label!: string;

  @ApiPropertyOptional({ example: 'room', description: 'What the code applies to (charge_type/payment_method/etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appliesTo?: string;
}
