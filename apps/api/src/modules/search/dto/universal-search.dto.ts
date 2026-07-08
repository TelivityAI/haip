import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UniversalSearchDto {
  @IsString()
  @MinLength(1)
  q!: string;

  @IsUUID()
  propertyId!: string;

  @IsOptional()
  @IsString()
  types?: string;
}
