import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { bookings, folios, payments, reservations } from '@telivityhaip/database';
import { publicApiBaseUrl } from '../payment/redsys-credentials.service';

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REFERENCE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const HOSTED_RETURN_PROVIDERS = ['redsys', 'worldline'] as const;
const hashReference = (reference: string) => createHash('sha256').update(reference).digest('hex');

export type PendingHostedCheckout = {
  id: string;
  propertyId: string;
  gatewayProvider: string | null;
  gatewayTransactionId: string | null;
  status: string;
  folioId?: string | null;
};

/** Limited, expiring capability. A succeeded payment may also reveal its confirmation number. */
export class BookingReturnService {
  constructor(
    private readonly db: any,
    private readonly config: ConfigService,
    private readonly syncPending?: (payment: PendingHostedCheckout) => Promise<string>,
  ) {}

  prepare(propertyId: string, destination?: string): { url: string; referenceHash: string; destination: string } {
    const target = this.validateDestination(destination);
    // The PSP limits both browser URLs to 250 characters. A server-owned relay
    // keeps the entire hotel URL out of that field and preserves it without truncation.
    let relay: URL;
    try {
      const base = new URL(publicApiBaseUrl(this.config));
      if (!this.allowedProtocol(base) || base.username || base.password || /[?#]/.test(base.href)) {
        throw new Error('Unsafe public API base URL');
      }
      const reference = randomBytes(32).toString('base64url');
      relay = new URL(`${base.href.replace(/\/$/, '')}/api/v1/booking-return/${reference}`);
      relay.searchParams.set('propertyId', propertyId);
      if (relay.href.length > 250) {
        throw new BadRequestException('Booking return relay URL exceeds the 250-character provider limit');
      }
      return { url: relay.href, referenceHash: hashReference(reference), destination: target.href };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('A valid public API base URL is required for booking returns');
    }
  }

  private allowedProtocol(url: URL): boolean {
    return url.protocol === 'https:' || (
      this.config.get<string>('NODE_ENV') !== 'production' && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  }

  private validateDestination(destination?: string): URL {
    let url: URL;
    try {
      url = new URL(destination ?? '');
    } catch {
      throw new BadRequestException('A valid booking return URL is required');
    }
    const origins = (this.config.get<string>('BOOKING_RETURN_ORIGINS') ?? '')
      .split(',').map((origin) => origin.trim()).filter(Boolean);
    if (!this.allowedProtocol(url) || url.username || url.password
      || !origins.includes(url.origin)) {
      throw new BadRequestException('Booking return URL origin is not allowed');
    }
    // Reload the actual host document, retaining its path, query and fragment.
    // Neither provider outcome is proof: both return to the same status view.
    url.searchParams.delete('redsys');
    url.searchParams.delete('worldline');
    url.searchParams.delete('haip_payment_return');
    for (const key of [...url.searchParams.keys()]) {
      if (/^ds_/i.test(key)) url.searchParams.delete(key);
    }
    return url;
  }

  private async findPayment(propertyId: string, reference: string) {
    if (!REFERENCE_PATTERN.test(reference)) throw new NotFoundException('Payment return not found');
    const [payment] = await this.db.select({
      id: payments.id,
      propertyId: payments.propertyId,
      folioId: payments.folioId,
      status: payments.status,
      createdAt: payments.createdAt,
      gatewayProvider: payments.gatewayProvider,
      gatewayTransactionId: payments.gatewayTransactionId,
      bookingReturnDestination: payments.bookingReturnDestination,
    })
      .from(payments)
      .where(and(eq(payments.propertyId, propertyId),
        eq(payments.bookingReturnReferenceHash, hashReference(reference)),
        inArray(payments.gatewayProvider, [...HOSTED_RETURN_PROVIDERS])));
    if (!payment || Date.now() - new Date(payment.createdAt).getTime() > REFERENCE_LIFETIME_MS) {
      throw new NotFoundException('Payment return not found');
    }
    return payment;
  }

  async resolve(propertyId: string, reference: string): Promise<string> {
    // Possession is paired with explicit tenant scope. No redirect destination
    // or payment result is taken from the request, including query parameters.
    const payment = await this.findPayment(propertyId, reference);
    let target: URL;
    try {
      target = this.validateDestination(payment.bookingReturnDestination);
    } catch {
      throw new NotFoundException('Payment return not found');
    }
    target.searchParams.set('haip_payment_return', reference);
    return target.href;
  }

  async status(propertyId: string, reference: string) {
    const payment = await this.findPayment(propertyId, reference);
    let status = payment.status;
    if (status === 'pending' && payment.gatewayProvider === 'worldline' && this.syncPending) {
      status = await this.syncPending(payment);
    }
    // A thrown bank read is not a finished result. Keep checking.
    if (status === 'unavailable') status = 'pending';
    const reported = ['authorized', 'captured', 'settled'].includes(status)
      ? 'succeeded' : status === 'failed' ? 'failed'
        : status === 'voided' ? 'cancelled'
          : status === 'pending' ? 'processing' : 'unavailable';
    if (reported !== 'succeeded' || !payment.folioId) return { status: reported };
    const confirmationNumber = await this.confirmationNumber(propertyId, payment.folioId);
    return confirmationNumber ? { status: reported, confirmationNumber } : { status: reported };
  }

  /** Property-scoped path: payment folio → reservation → booking. */
  private async confirmationNumber(propertyId: string, folioId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ confirmationNumber: bookings.confirmationNumber })
      .from(folios)
      .innerJoin(reservations, eq(reservations.id, folios.reservationId))
      .innerJoin(bookings, eq(bookings.id, reservations.bookingId))
      .where(and(
        eq(folios.id, folioId),
        eq(folios.propertyId, propertyId),
        eq(reservations.propertyId, propertyId),
        eq(bookings.propertyId, propertyId),
      ));
    return row?.confirmationNumber ?? null;
  }
}
