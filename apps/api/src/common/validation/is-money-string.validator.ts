import {
  registerDecorator,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import Decimal from 'decimal.js';

export interface MoneyStringOptions {
  /** Allow exactly zero (default false → must be strictly positive). */
  allowZero?: boolean;
  /** Allow negative amounts (default false). Use for credit/adjustment fields. */
  allowNegative?: boolean;
}

@ValidatorConstraint({ name: 'isMoneyString', async: false })
class MoneyStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: any): boolean {
    if (typeof value !== 'string' || value.trim() === '') return false;
    let d: Decimal;
    try {
      d = new Decimal(value);
    } catch {
      return false;
    }
    if (!d.isFinite()) return false;
    const opts: MoneyStringOptions = args?.constraints?.[0] ?? {};
    if (!opts.allowNegative && d.isNegative()) return false;
    if (!opts.allowZero && !opts.allowNegative && d.isZero()) return false;
    return true;
  }

  defaultMessage(args: any): string {
    const opts: MoneyStringOptions = args?.constraints?.[0] ?? {};
    const bound = opts.allowNegative
      ? 'a numeric decimal string'
      : opts.allowZero
        ? 'a non-negative numeric decimal string'
        : 'a positive numeric decimal string';
    return `${args?.property} must be ${bound}`;
  }
}

/**
 * Validates a monetary value supplied as a decimal STRING (amounts are stored as
 * numeric strings to avoid float drift). Rejects NaN/Infinity and — by default —
 * zero and negatives, closing the "negative amount inverts the folio balance"
 * class of bug. Pass `{ allowNegative: true }` for legitimate credit/adjustment
 * fields, `{ allowZero: true }` where zero is meaningful (e.g. comp rooms).
 */
export function IsMoneyString(
  opts: MoneyStringOptions = {},
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [opts],
      validator: MoneyStringConstraint,
    });
  };
}
