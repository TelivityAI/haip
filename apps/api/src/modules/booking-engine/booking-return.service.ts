import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { payments } from '@telivityhaip/database';

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REFERENCE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const hashReference = (reference: string) => createHash('sha256').update(reference).digest('hex');

/** Limited, expiring capability: reveals payment state only, never booking credentials. */
export class BookingReturnService {
  constructor(private readonly db: any, private readonly config: ConfigService) {}

  prepare(destination?: string): { url: string; referenceHash: string } {
    let url: URL;
    try {
      url = new URL(destination ?? '');
    } catch {
      throw new BadRequestException('A valid booking return URL is required');
    }
    const origins = (this.config.get<string>('BOOKING_RETURN_ORIGINS') ?? '')
      .split(',').map((origin) => origin.trim()).filter(Boolean);
    const localDevelopment = this.config.get<string>('NODE_ENV') !== 'production'
      && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!localDevelopment && url.protocol !== 'https:') || url.username || url.password
      || !origins.includes(url.origin)) {
      throw new BadRequestException('Booking return URL origin is not allowed');
    }
    // Reload the actual host document, retaining its path, query and fragment.
    // Neither provider outcome is proof: both return to the same status view.
    url.searchParams.delete('redsys');
    url.searchParams.delete('haip_payment_return');
    for (const key of [...url.searchParams.keys()]) {
      if (/^ds_/i.test(key)) url.searchParams.delete(key);
    }
    const reference = randomBytes(32).toString('base64url');
    url.searchParams.set('haip_payment_return', reference);
    if (url.href.length > 2048) throw new BadRequestException('Booking return URL is too long');
    return { url: url.href, referenceHash: hashReference(reference) };
  }

  async status(propertyId: string, reference: string) {
    if (!REFERENCE_PATTERN.test(reference)) throw new NotFoundException('Payment return not found');
    const [payment] = await this.db.select({ status: payments.status, createdAt: payments.createdAt })
      .from(payments)
      .where(and(eq(payments.propertyId, propertyId),
        eq(payments.bookingReturnReferenceHash, hashReference(reference)),
        eq(payments.gatewayProvider, 'redsys')));
    if (!payment || Date.now() - new Date(payment.createdAt).getTime() > REFERENCE_LIFETIME_MS) {
      throw new NotFoundException('Payment return not found');
    }
    const status = ['authorized', 'captured', 'settled'].includes(payment.status)
      ? 'succeeded' : payment.status === 'failed' ? 'failed'
        : payment.status === 'voided' ? 'cancelled'
          : payment.status === 'pending' ? 'processing' : 'unavailable';
    return { status };
  }
}
