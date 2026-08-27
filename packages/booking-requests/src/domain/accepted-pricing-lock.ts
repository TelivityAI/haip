import { and, eq } from 'drizzle-orm';
import { reservations } from '@telivityhaip/database';

/**
 * Package-local copy of apps/api's
 * `apps/api/src/common/database/accepted-pricing-lock.ts` — fully
 * self-contained (only depends on the shared `reservations` Drizzle table),
 * duplicated here rather than imported so this package never imports from
 * apps/api.
 */
type TransactionWork<T> = (tx: any) => Promise<T>;

/**
 * Serialize every accepted-price snapshot reader/writer for one reservation.
 * The reservation row is the shared mutex for accepted-price readers/writers.
 */
export async function withAcceptedPricingLock<T>(
  db: any,
  propertyId: string,
  reservationId: string,
  work: TransactionWork<T>,
  existingTx?: any,
): Promise<T> {
  const execute = async (tx: any) => {
    const [locked] = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(
        eq(reservations.id, reservationId),
        eq(reservations.propertyId, propertyId),
      ))
      .for('update');
    if (!locked) {
      throw new Error(
        `Reservation ${reservationId} not found for accepted-pricing lock`,
      );
    }
    return work(tx);
  };

  return existingTx ? execute(existingTx) : db.transaction(execute);
}
