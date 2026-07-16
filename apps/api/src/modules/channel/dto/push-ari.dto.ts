import { IsUUID, IsDateString, IsOptional, IsBoolean, IsIn } from 'class-validator';

export class PushAriDto {
  @IsUUID()
  propertyId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsUUID()
  channelConnectionId?: string;

  /**
   * DerbySoft ARI mode. Delta = incremental (default); Overlay = full refresh
   * (delete+insert for the date window). Other adapters ignore this field.
   */
  @IsOptional()
  @IsIn(['Delta', 'Overlay'])
  ariUpdateType?: 'Delta' | 'Overlay';

  /**
   * When true with push/full, run Overlay flush asynchronously (fire-and-forget).
   * BullMQ channel queues are not wired yet — this is the pragmatic async path.
   */
  @IsOptional()
  @IsBoolean()
  asyncFlush?: boolean;
}