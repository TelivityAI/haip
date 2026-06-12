import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRolesDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Full set of role ids for the user at this property (replaces existing)' })
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds!: string[];
}
