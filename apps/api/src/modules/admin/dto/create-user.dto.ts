import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsIn,
  IsArray,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OIDC_SUB_RE } from '@telivityhaip/database';

export const USER_STATUSES = ['active', 'disabled', 'invited'] as const;

export class CreateUserDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ example: 'anna@grandhotel.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Anna Front Desk' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ enum: USER_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({
    description:
      'IdP subject (`sub`) that links a real login: a UUID for Keycloak, any OIDC subject otherwise (same rule as isValidKeycloakSub / OIDC_SUB_RE)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(OIDC_SUB_RE, {
    message: 'keycloakSub must be the IdP subject (1–255 printable ASCII)',
  })
  keycloakSub?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Role ids to assign on creation' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds?: string[];
}
