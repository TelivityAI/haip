import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsDateString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CardGuaranteeInfo, CardGuaranteeStatus } from '@telivityhaip/database';

export const CARD_GUARANTEE_STATUSES: readonly CardGuaranteeStatus[] = [
  'valid',
  'missing',
  'expired',
  'declined',
] as const;

export class CardGuaranteeDto {
  @ApiProperty({ enum: CARD_GUARANTEE_STATUSES })
  @IsIn(CARD_GUARANTEE_STATUSES)
  status!: CardGuaranteeStatus;

  @ApiPropertyOptional({ example: 'visa' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardBrand?: string;

  @ApiPropertyOptional({ example: '4242', description: 'Last 4 digits only (never full PAN)' })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'last4 must be exactly 4 digits' })
  last4?: string;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  expMonth?: number;

  @ApiPropertyOptional({ example: 2028 })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  expYear?: number;

  @ApiPropertyOptional({ example: 'Sofia Martinez' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  holderName?: string;

  @ApiPropertyOptional({ example: '2026-11-15T14:00:00Z' })
  @IsOptional()
  @IsDateString()
  verifiedAt?: string;

  @ApiPropertyOptional({ example: 'Card expired prior to stay' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * Strip unknown/sensitive keys and enforce safe card-guarantee metadata shape
 * (status + masked card summary only; never PAN, CVV, or raw PSP tokens).
 */
export function sanitizeCardGuarantee(input: unknown): CardGuaranteeInfo | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const status = String(raw['status'] ?? '').trim().toLowerCase() as CardGuaranteeStatus;
  if (!CARD_GUARANTEE_STATUSES.includes(status)) return null;

  const rawLast4 = raw['last4'] != null ? String(raw['last4']).trim() : '';
  const last4 = /^\d{4}$/.test(rawLast4) ? rawLast4 : null;
  const expMonthNum = raw['expMonth'] != null ? Number(raw['expMonth']) : NaN;
  const expMonth =
    Number.isInteger(expMonthNum) && expMonthNum >= 1 && expMonthNum <= 12 ? expMonthNum : null;
  const expYearNum = raw['expYear'] != null ? Number(raw['expYear']) : NaN;
  const expYear =
    Number.isInteger(expYearNum) && expYearNum >= 2000 && expYearNum <= 2100 ? expYearNum : null;

  const cleanStr = (val: unknown, max: number): string | null => {
    if (typeof val !== 'string') return null;
    const trimmed = val.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };

  return {
    status,
    cardBrand: cleanStr(raw['cardBrand'], 32),
    last4,
    expMonth,
    expYear,
    holderName: cleanStr(raw['holderName'], 120),
    verifiedAt: cleanStr(raw['verifiedAt'], 64),
    reason: cleanStr(raw['reason'], 200),
  };
}

export function resolveReservationCardGuarantee(
  reservation: Record<string, unknown> | null | undefined,
): CardGuaranteeInfo | null {
  if (!reservation) return null;
  const direct = sanitizeCardGuarantee(reservation['cardGuarantee']);
  if (direct) return direct;
  const prefs = reservation['preferences'];
  if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) {
    return sanitizeCardGuarantee((prefs as Record<string, unknown>)['cardGuarantee']);
  }
  return null;
}
