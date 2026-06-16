import {
  registerDecorator,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isLiterallySafeHttpUrl } from './url-guard';

@ValidatorConstraint({ name: 'isSafeHttpUrl', async: false })
class SafeHttpUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: any): boolean {
    if (typeof value !== 'string') return false;
    const requireHttps = args?.constraints?.[0]?.requireHttps ?? false;
    return isLiterallySafeHttpUrl(value, { requireHttps });
  }
  defaultMessage(): string {
    return 'must be a public http(s) URL (private/loopback hosts are not allowed)';
  }
}

/**
 * Validates a URL is a public http(s) target and not a private/loopback/
 * metadata host (literal check; DNS is re-checked server-side at use time).
 */
export function IsSafeHttpUrl(
  opts: { requireHttps?: boolean } = {},
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [opts],
      validator: SafeHttpUrlConstraint,
    });
  };
}
