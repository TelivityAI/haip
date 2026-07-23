import { PickType } from '@nestjs/swagger';
import { CheckInDto } from './check-in.dto';

/** Advance check-in / pre-register — registration + ID fields only (no status change). */
export class PreRegisterDto extends PickType(CheckInDto, [
  'registrationSigned',
  'registrationData',
  'idType',
  'idNumber',
  'idCountry',
  'idExpiry',
] as const) {}
