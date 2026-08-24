import { ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';

export type MoneyValue = string | number | Decimal;
export type BookingRequestPriceSource = 'submitted' | 'current' | 'custom';

export type ResolveAcceptedTotalInput = {
  source: BookingRequestPriceSource;
  submittedTotal?: MoneyValue | null;
  currentTotal?: MoneyValue | null;
  customTotal?: MoneyValue | null;
  customReason?: string | null;
};

export type AcceptedTotalResolution = {
  source: BookingRequestPriceSource;
  total: Decimal;
  customReason?: string;
};

export type ResolveInstallmentAmountInput = {
  /** Accepted total against which a percentage installment is resolved. */
  total?: MoneyValue | null;
  acceptedTotal?: MoneyValue | null;
  fixedAmount?: MoneyValue | null;
  percentage?: MoneyValue | null;
  /** Optional existing allocation, useful when validating an edited plan. */
  allocatedAmount?: MoneyValue | null;
};

export type AllocationAmountInput = {
  amount: MoneyValue;
  movementAmount: MoneyValue;
  installmentAmount: MoneyValue;
};

export type CapturedMovement = {
  id?: string;
  paymentId?: string;
  status?: string;
  type?: string;
  amount: MoneyValue;
  /** Use this when the caller has already calculated refunds against a movement. */
  netAmount?: MoneyValue | null;
};

export type DenialResolution = {
  id?: string;
  paymentId?: string;
  movementId?: string;
  type: 'refund' | 'external_return' | 'retained';
  amount: MoneyValue;
};

function decimal(value: MoneyValue, field: string): Decimal {
  try {
    const result = new Decimal(value);
    if (!result.isFinite()) throw new Error('not finite');
    return result;
  } catch {
    throw new ConflictException(`Invalid ${field} amount`);
  }
}

function positive(value: MoneyValue, field: string): Decimal {
  const result = decimal(value, field);
  if (result.lte(0)) {
    throw new ConflictException(`${field} must be positive`);
  }
  return result;
}

function currency(value: Decimal): Decimal {
  return value.toDecimalPlaces(2);
}

function selectedTotal(
  source: BookingRequestPriceSource,
  input: ResolveAcceptedTotalInput,
): MoneyValue {
  switch (source) {
    case 'submitted':
      if (input.submittedTotal == null) {
        throw new ConflictException('Submitted total is required');
      }
      return input.submittedTotal;
    case 'current':
      if (input.currentTotal == null) {
        throw new ConflictException('Current total is required');
      }
      return input.currentTotal;
    case 'custom':
      if (input.customTotal == null) {
        throw new ConflictException('Custom total is required');
      }
      return input.customTotal;
  }
}

export function resolveAcceptedTotal(
  input: ResolveAcceptedTotalInput,
): AcceptedTotalResolution {
  const selected = selectedTotal(input.source, input);
  // Submitted/current totals come from an authoritative quote. Custom totals
  // are staff-entered and therefore require the explicit positive-money rule.
  const total = input.source === 'custom'
    ? positive(selected, 'Custom accepted total')
    : currency(decimal(selected, `${input.source} accepted total`));

  if (input.source === 'custom') {
    const reason = input.customReason?.trim();
    if (!reason) {
      throw new ConflictException('A reason is required for a custom accepted price');
    }
    return { source: input.source, total: currency(total), customReason: reason };
  }

  return { source: input.source, total: currency(total), customReason: undefined };
}

export function resolveInstallmentAmount(
  input: ResolveInstallmentAmountInput,
): Decimal {
  const hasFixed = input.fixedAmount != null;
  const hasPercentage = input.percentage != null;
  if (hasFixed === hasPercentage) {
    throw new ConflictException('An installment requires exactly one fixed amount or percentage');
  }

  let result: Decimal;
  if (hasFixed) {
    result = positive(input.fixedAmount!, 'Fixed installment amount');
  } else {
    const percentage = positive(input.percentage!, 'Installment percentage');
    if (input.total == null && input.acceptedTotal == null) {
      throw new ConflictException('Accepted total is required for a percentage installment');
    }
    const total = positive(input.total ?? input.acceptedTotal!, 'Accepted total');
    result = total.times(percentage).div(100);
  }

  result = currency(result);
  if (result.lte(0)) {
    throw new ConflictException('Installment amount must be positive');
  }

  if (input.allocatedAmount != null) {
    const allocated = positive(input.allocatedAmount, 'Allocated amount');
    if (allocated.gt(result)) {
      throw new ConflictException('Allocated amount cannot exceed the installment total');
    }
  }

  return result;
}

/** Validate a payment allocation against both the movement and installment. */
export function assertAllocationAmount(input: AllocationAmountInput): void {
  const amount = positive(input.amount, 'Allocation amount');
  const movement = positive(input.movementAmount, 'Payment movement amount');
  const installment = positive(input.installmentAmount, 'Installment amount');
  if (amount.gt(movement)) {
    throw new ConflictException('Allocation amount cannot exceed the payment movement amount');
  }
  if (amount.gt(installment)) {
    throw new ConflictException('Allocation amount cannot exceed the installment amount');
  }
}

function movementKey(movement: CapturedMovement): string | undefined {
  return movement.paymentId ?? movement.id;
}

function isCapturedMovement(movement: CapturedMovement): boolean {
  if (movement.status && !['captured', 'settled', 'partially_refunded', 'refunded'].includes(movement.status)) {
    return false;
  }
  // Refund/correction child rows are not independent captured money.
  if (movement.type === 'refund' || movement.type === 'external_return') return false;
  positive(movement.netAmount ?? movement.amount, 'Captured payment amount');
  return true;
}

/**
 * Denial may proceed only after every positive captured movement is returned or
 * retained. Resolutions are grouped by payment/movement ID when supplied.
 */
export function assertDenialMoneyResolved(
  movements: readonly CapturedMovement[],
  resolutions: readonly DenialResolution[],
): void {
  const captured = movements.filter(isCapturedMovement);
  const capturedKeys = new Set(captured.map(movementKey).filter((key): key is string => key != null));

  const sums = new Map<string, Decimal>();
  let unkeyed = new Decimal(0);
  for (const resolution of resolutions) {
    const amount = positive(resolution.amount, `${resolution.type} resolution`);
    const key = resolution.paymentId ?? resolution.movementId;
    if (key != null && !capturedKeys.has(key)) {
      throw new ConflictException(`Resolution references unknown captured movement '${key}'`);
    }
    if (key == null) {
      unkeyed = unkeyed.plus(amount);
    } else {
      sums.set(key, (sums.get(key) ?? new Decimal(0)).plus(amount));
    }
  }

  if (captured.length === 0) {
    if (resolutions.length > 0) {
      throw new ConflictException('Resolution references no captured movement');
    }
    return;
  }

  for (const movement of captured) {
    const expected = currency(decimal(movement.netAmount ?? movement.amount, 'movement'));
    const key = movementKey(movement);
    const resolved = key != null
      ? (sums.get(key) ?? new Decimal(0))
      : unkeyed;
    if (!resolved.eq(expected)) {
      const label = key ?? 'unidentified movement';
      throw new ConflictException(
        `Captured movement '${label}' has unresolved money: expected ${expected.toFixed(2)}, resolved ${resolved.toFixed(2)}`,
      );
    }
  }
}
