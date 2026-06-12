import {
  IsArray,
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BulkActionDto {
  @ApiProperty({ description: 'Reservation IDs to act on', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];

  @ApiProperty({
    description: 'Action to apply to each reservation',
    enum: ['check_in', 'check_out', 'cancel'],
  })
  @IsEnum(['check_in', 'check_out', 'cancel'])
  action!: 'check_in' | 'check_out' | 'cancel';

  @ApiPropertyOptional({ description: 'Reason — used as cancellation reason for the cancel action' })
  @IsOptional()
  @IsString()
  reason?: string;
}
