import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [String],
    description: 'Full set of permission keys for the role (replaces existing). Each must exist in the permission catalog.',
  })
  @IsArray()
  @IsString({ each: true })
  permissionKeys!: string[];
}
