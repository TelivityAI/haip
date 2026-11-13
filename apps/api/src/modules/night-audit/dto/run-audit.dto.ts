import { IsUUID, IsDateString, IsOptional, IsIn } from 'class-validator';

export class RunAuditDto {
  @IsUUID()
  propertyId!: string;

  @IsDateString()
  businessDate!: string;

  /**
   * `unattended`: scheduled close (`scripts/cron/night-audit.sh`).
   * `manual` or omitted: staff close.
   * Accepted so the global ValidationPipe does not reject the cron body.
   * This service does not branch on the value.
   */
  @IsOptional()
  @IsIn(['manual', 'unattended'])
  mode?: 'manual' | 'unattended';
}
