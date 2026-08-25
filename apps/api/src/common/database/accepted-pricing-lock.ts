import { sql } from 'drizzle-orm';

type TransactionWork<T> = (tx: any) => Promise<T>;

/**
 * Serialize every accepted-price snapshot reader/writer for one reservation.
 * The transaction-scoped advisory lock has one composite key, so callers never
 * need to coordinate multiple lock orders and a rollback always releases it.
 */
export async function withAcceptedPricingLock<T>(
  db: any,
  propertyId: string,
  reservationId: string,
  work: TransactionWork<T>,
  existingTx?: any,
): Promise<T> {
  const execute = async (tx: any) => {
    const lockKey = `accepted-pricing:${propertyId}:${reservationId}`;
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))
    `);
    return work(tx);
  };

  return existingTx ? execute(existingTx) : db.transaction(execute);
}
