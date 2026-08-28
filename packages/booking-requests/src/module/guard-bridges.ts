import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Observable } from 'rxjs';
import {
  BookingEngineScopeGuardPort,
  BookingKeyGuardPort,
  BookingThrottleGuardPort,
} from './ports.js';

/**
 * Bridges the abstract guard PORT tokens (see `./ports.js`) to concrete
 * classes usable in `@UseGuards(...)`.
 *
 * NestJS resolves `@UseGuards(SomeClass)` through the module's `injectables`
 * collection, which is populated purely by scanning `@UseGuards` decorator
 * metadata on controllers/handlers — a completely separate path from the
 * `providers` collection. A bare `{ provide: PORT, useExisting: … }` binding
 * (in `providers`) is invisible to that resolver, so `@UseGuards(PORT)`
 * directly would make Nest instantiate a bare `new PORT()` with no
 * `canActivate` implementation (an abstract method compiles to nothing at
 * runtime) — that guard is then silently dropped from the chain, and every
 * request sails through unauthenticated.
 *
 * These concrete, `@Injectable()` bridge classes are what actually go in
 * `@UseGuards(...)` instead. Each is a real provider (registered in
 * `BookingRequestModule.forRoot`'s `providers`) that constructor-injects the
 * corresponding port token — resolved via that same module's `useExisting`
 * binding to the real core guard singleton — and delegates `canActivate` to
 * it 1:1, so behavior is identical to using the core guard directly.
 */
@Injectable()
export class BookingKeyGuardBridge implements CanActivate {
  constructor(@Inject(BookingKeyGuardPort) private readonly guard: CanActivate) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.guard.canActivate(context);
  }
}

@Injectable()
export class BookingEngineScopeGuardBridge implements CanActivate {
  constructor(@Inject(BookingEngineScopeGuardPort) private readonly guard: CanActivate) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.guard.canActivate(context);
  }
}

@Injectable()
export class BookingThrottleGuardBridge implements CanActivate {
  constructor(@Inject(BookingThrottleGuardPort) private readonly guard: CanActivate) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.guard.canActivate(context);
  }
}
