import { BadRequestException } from '@nestjs/common';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCanonicalCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function assertCanonicalStayDates(checkIn: unknown, checkOut: unknown): void {
  if (!isCanonicalCalendarDate(checkIn) || !isCanonicalCalendarDate(checkOut)) {
    throw new BadRequestException('Check-in and check-out must be valid YYYY-MM-DD dates');
  }
  if (checkOut <= checkIn) {
    throw new BadRequestException('Check-out must be after check-in');
  }
}

@ValidatorConstraint({ name: 'canonicalCalendarDate', async: false })
class CanonicalCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isCanonicalCalendarDate(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid YYYY-MM-DD calendar date`;
  }
}

export function IsCanonicalCalendarDate(validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: CanonicalCalendarDateConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'afterCheckIn', async: false })
class AfterCheckInConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const checkIn = (args.object as { checkIn?: unknown }).checkIn;
    return isCanonicalCalendarDate(checkIn)
      && isCanonicalCalendarDate(value)
      && value > checkIn;
  }

  defaultMessage(): string {
    return 'checkOut must be after checkIn';
  }
}

export function IsAfterCheckIn(validationOptions?: ValidationOptions) {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: AfterCheckInConstraint,
    });
  };
}
