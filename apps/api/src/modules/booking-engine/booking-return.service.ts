import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { payments } from '@telivityhaip/database';
import { publicApiBaseUrl } from '../payment/redsys-credentials.service';

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REFERENCE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const hashReference = (reference: string) => createHash('sha256').update(reference).digest('hex');

/** Limited, expiring capability: reveals payment state only, never booking credentials. */
export class BookingReturnService {
  constructor(private readonly db: any, private readonly config: ConfigService) {}

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
    url.searchParams.delete('haip_payment_return');
    for (const key of [...url.searchParams.keys()]) {
      if (/^ds_/i.test(key)) url.searchParams.delete(key);
    }
    return url;
  }

  private async findPayment(propertyId: string, reference: string) {
    if (!REFERENCE_PATTERN.test(reference)) throw new NotFoundException('Payment return not found');
    const [payment] = await this.db.select({ status: payments.status, createdAt: payments.createdAt,
      bookingReturnDestination: payments.bookingReturnDestination })
      .from(payments)
      .where(and(eq(payments.propertyId, propertyId),
        eq(payments.bookingReturnReferenceHash, hashReference(reference)),
        eq(payments.gatewayProvider, 'redsys')));
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
    const status = ['authorized', 'captured', 'settled'].includes(payment.status)
      ? 'succeeded' : payment.status === 'failed' ? 'failed'
        : payment.status === 'voided' ? 'cancelled'
          : payment.status === 'pending' ? 'processing' : 'unavailable';
    return { status };
  }
}
