import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '@telivityhaip/database';
import type {
  BookingFormQuestionDefinition,
  BookingMode,
  PaymentMethodCollection,
} from '@telivityhaip/database';
import { bookingEngineConfigRequestFields } from '../database/schema/booking-engine.js';

/**
 * DI token + adapter letting core's `BookingEngineConfigService` (apps/api)
 * read/write the `booking_mode` / `payment_method_collection` /
 * `form_questions` columns this package owns (see
 * `../database/schema/booking-engine.ts`) WITHOUT core declaring those
 * columns in its own Drizzle schema or push-schema baseline.
 *
 * Only bound (via `BookingRequestModule.forRoot`, which is `global: true`)
 * when `HAIP_BOOKING_REQUESTS=true` loads this package. Core's
 * `BookingEngineConfigService` injects this with `@Optional()` and falls
 * back to instant/disabled/[] defaults when it's absent, so it never
 * selects or requires these columns while the package is unloaded.
 */
export const BOOKING_REQUEST_CONFIG_FIELDS_PORT = Symbol('BOOKING_REQUEST_CONFIG_FIELDS_PORT');

export interface BookingRequestConfigFields {
  bookingMode: BookingMode;
  paymentMethodCollection: PaymentMethodCollection;
  formQuestions: BookingFormQuestionDefinition[];
}

export type BookingRequestConfigFieldsPatch = Partial<BookingRequestConfigFields>;

export interface BookingRequestConfigFieldsPort {
  /** `conn` lets the caller pass its own transaction so this read observes an in-progress `FOR UPDATE` lock taken by the caller on the same physical row. */
  read(propertyId: string, conn?: unknown): Promise<BookingRequestConfigFields>;
  /** `tx` MUST be the same transaction the caller used to lock the row, so this write commits atomically with the caller's own patch. */
  write(
    tx: unknown,
    propertyId: string,
    patch: BookingRequestConfigFieldsPatch,
  ): Promise<BookingRequestConfigFields>;
}

const SELECT_COLUMNS = {
  bookingMode: bookingEngineConfigRequestFields.bookingMode,
  paymentMethodCollection: bookingEngineConfigRequestFields.paymentMethodCollection,
  formQuestions: bookingEngineConfigRequestFields.formQuestions,
};

function notFound(propertyId: string): Error {
  return new Error(
    `booking_engine_config row for property ${propertyId} not found — ` +
      'BookingEngineConfigService.getConfig() must run first to create it',
  );
}

@Injectable()
export class DrizzleBookingRequestConfigFieldsAdapter implements BookingRequestConfigFieldsPort {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async read(propertyId: string, conn?: unknown): Promise<BookingRequestConfigFields> {
    const connection = (conn ?? this.db) as any;
    const [row] = await connection
      .select(SELECT_COLUMNS)
      .from(bookingEngineConfigRequestFields)
      .where(eq(bookingEngineConfigRequestFields.propertyId, propertyId));
    if (!row) throw notFound(propertyId);
    return row;
  }

  async write(
    tx: unknown,
    propertyId: string,
    patch: BookingRequestConfigFieldsPatch,
  ): Promise<BookingRequestConfigFields> {
    const connection = (tx ?? this.db) as any;
    if (Object.keys(patch).length === 0) {
      return this.read(propertyId, connection);
    }

    const [row] = await connection
      .update(bookingEngineConfigRequestFields)
      .set(patch)
      .where(eq(bookingEngineConfigRequestFields.propertyId, propertyId))
      .returning(SELECT_COLUMNS);
    if (!row) throw notFound(propertyId);
    return row;
  }
}
