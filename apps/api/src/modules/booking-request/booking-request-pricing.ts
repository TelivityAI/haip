import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AcceptedPricingSnapshot } from './booking-request-db.js';
import Decimal from 'decimal.js';
import {
  assertLedgerCurrencySupported,
  type BookingRequestPriceSource,
} from './booking-request-money';

type QuoteRecord = Record<string, unknown>;

export interface BuildAcceptedPricingInput {
  source: BookingRequestPriceSource;
  requestCurrencyCode: string;
  submittedQuote: unknown;
  currentQuote: unknown;
  customTotal?: string;
  customReason?: string;
}

function object(value: unknown, label: string): QuoteRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConflictException(`${label} is not a valid quote snapshot`);
  }
  return value as QuoteRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConflictException(`${label} is missing from the quote snapshot`);
  }
  return value;
}

function money(
  value: unknown,
  label: string,
  currencyCode: string,
  currencyExponent: number,
): Decimal {
  const raw = string(value, label);
  let parsed: Decimal;
  try {
    parsed = new Decimal(raw);
    if (!parsed.isFinite() || parsed.isNegative()) throw new Error('invalid');
  } catch {
    throw new ConflictException(`${label} is not valid money`);
  }
  if (parsed.decimalPlaces() > currencyExponent) {
    throw new ConflictException(
      `${label} has fractional minor units for ${currencyCode}`,
    );
  }
  return parsed;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new ConflictException(`${label} is not a valid quantity`);
  }
  return Number(value);
}

function assertCurrency(
  quote: QuoteRecord,
  requestCurrencyCode: string,
  label: string,
): void {
  const currency = string(quote['currencyCode'], `${label} currency`);
  if (currency !== requestCurrencyCode) {
    throw new ConflictException(
      `${label} currency ${currency} does not match request currency ${requestCurrencyCode}`,
    );
  }
}

function normalizeQuote(
  quote: QuoteRecord,
  source: BookingRequestPriceSource,
  requestCurrencyCode: string,
  currencyExponent: number,
): Omit<
  AcceptedPricingSnapshot,
  'version' | 'source' | 'customReason' | 'adjustment'
> {
  const rawNights = quote['lineItems'];
  if (!Array.isArray(rawNights) || rawNights.length === 0) {
    throw new ConflictException('Accepted quote has no nightly pricing');
  }
  const seenDates = new Set<string>();
  const nights = rawNights.map((raw, index) => {
    const row = object(raw, `Night ${index + 1}`);
    const date = string(row['date'], `Night ${index + 1} date`);
    if (seenDates.has(date)) {
      throw new ConflictException(`Accepted quote repeats night ${date}`);
    }
    seenDates.add(date);
    return {
      date,
      roomAmount: money(row['rate'], `Night ${date} room amount`, requestCurrencyCode, currencyExponent).toFixed(2),
      taxAmount: money(row['tax'], `Night ${date} tax amount`, requestCurrencyCode, currencyExponent).toFixed(2),
    };
  });

  const rawServices = quote['services'];
  if (!Array.isArray(rawServices)) {
    throw new ConflictException('Accepted quote services are invalid');
  }
  const services = rawServices.map((raw, index) => {
    const row = object(raw, `Service ${index + 1}`);
    const currencyCode = string(row['currencyCode'], `Service ${index + 1} currency`);
    if (currencyCode !== requestCurrencyCode) {
      throw new ConflictException(
        `Service currency ${currencyCode} does not match request currency ${requestCurrencyCode}`,
      );
    }
    const rawLineItems = row['lineItems'];
    if (!Array.isArray(rawLineItems)) {
      throw new ConflictException(`Service ${index + 1} line items are invalid`);
    }
    return {
      serviceId: string(row['serviceId'], `Service ${index + 1} id`),
      code: string(row['code'], `Service ${index + 1} code`),
      name: string(row['name'], `Service ${index + 1} name`),
      postingRule: string(row['postingRule'], `Service ${index + 1} posting rule`),
      chargeType: string(row['chargeType'], `Service ${index + 1} charge type`),
      currencyCode,
      unitPrice: money(row['unitPrice'], `Service ${index + 1} unit price`, requestCurrencyCode, currencyExponent).toFixed(2),
      quantity: integer(row['quantity'], `Service ${index + 1} quantity`),
      lineTotal: money(row['lineTotal'], `Service ${index + 1} total`, requestCurrencyCode, currencyExponent).toFixed(2),
      taxTotal: money(row['taxTotal'], `Service ${index + 1} tax`, requestCurrencyCode, currencyExponent).toFixed(2),
      lineItems: rawLineItems.map((rawLine, lineIndex) => {
        const line = object(rawLine, `Service ${index + 1} line ${lineIndex + 1}`);
        return {
          date: string(line['date'], `Service ${index + 1} line date`),
          amount: money(line['amount'], `Service ${index + 1} line amount`, requestCurrencyCode, currencyExponent).toFixed(2),
          taxAmount: money(line['tax'], `Service ${index + 1} line tax`, requestCurrencyCode, currencyExponent).toFixed(2),
        };
      }),
    };
  });

  const roomTotal = money(quote['roomTotal'], 'Room total', requestCurrencyCode, currencyExponent);
  const taxTotal = money(quote['taxTotal'], 'Room tax total', requestCurrencyCode, currencyExponent);
  const servicesTotal = money(quote['servicesTotal'], 'Services total', requestCurrencyCode, currencyExponent);
  const servicesTaxTotal = money(quote['servicesTaxTotal'], 'Services tax total', requestCurrencyCode, currencyExponent);
  const grandTotal = money(quote['grandTotal'], 'Grand total', requestCurrencyCode, currencyExponent);
  const nightlyRoomTotal = nights.reduce(
    (sum, night) => sum.plus(night.roomAmount),
    new Decimal(0),
  );
  const nightlyTaxTotal = nights.reduce(
    (sum, night) => sum.plus(night.taxAmount),
    new Decimal(0),
  );
  if (!nightlyRoomTotal.equals(roomTotal)) {
    throw new ConflictException('Accepted nightly room lines do not equal room total');
  }
  if (!nightlyTaxTotal.equals(taxTotal)) {
    throw new ConflictException('Accepted nightly tax lines do not equal room tax total');
  }
  for (const service of services) {
    const serviceLineTotal = service.lineItems.reduce(
      (sum, line) => sum.plus(line.amount),
      new Decimal(0),
    );
    const serviceLineTax = service.lineItems.reduce(
      (sum, line) => sum.plus(line.taxAmount),
      new Decimal(0),
    );
    if (!serviceLineTotal.equals(service.lineTotal)) {
      throw new ConflictException(
        `Accepted service ${service.code} lines do not equal its total`,
      );
    }
    if (!serviceLineTax.equals(service.taxTotal)) {
      throw new ConflictException(
        `Accepted service ${service.code} tax lines do not equal its tax total`,
      );
    }
  }
  const serviceComponentTotal = services.reduce(
    (sum, service) => sum.plus(service.lineTotal),
    new Decimal(0),
  );
  const serviceComponentTax = services.reduce(
    (sum, service) => sum.plus(service.taxTotal),
    new Decimal(0),
  );
  if (!serviceComponentTotal.equals(servicesTotal)) {
    throw new ConflictException('Accepted service lines do not equal services total');
  }
  if (!serviceComponentTax.equals(servicesTaxTotal)) {
    throw new ConflictException('Accepted service tax lines do not equal services tax total');
  }
  const componentsTotal = roomTotal.plus(taxTotal).plus(servicesTotal).plus(servicesTaxTotal);
  if (!componentsTotal.equals(grandTotal)) {
    throw new ConflictException(
      `${source} quote components do not equal its grand total`,
    );
  }

  return {
    currencyCode: requestCurrencyCode,
    grandTotal: grandTotal.toFixed(2),
    roomTotal: roomTotal.toFixed(2),
    taxTotal: taxTotal.toFixed(2),
    nights,
    services,
    servicesTotal: servicesTotal.toFixed(2),
    servicesTaxTotal: servicesTaxTotal.toFixed(2),
  };
}

export function buildAcceptedPricingSnapshot(
  input: BuildAcceptedPricingInput,
): AcceptedPricingSnapshot {
  const exponent = assertLedgerCurrencySupported(
    input.requestCurrencyCode,
    (message) => new ConflictException(message),
  );
  const submitted = object(input.submittedQuote, 'Submitted quote');
  const current = object(input.currentQuote, 'Current quote');
  assertCurrency(submitted, input.requestCurrencyCode, 'Submitted quote');
  assertCurrency(current, input.requestCurrencyCode, 'Current quote');

  const basis = input.source === 'submitted' ? submitted : current;
  const normalized = normalizeQuote(
    basis,
    input.source,
    input.requestCurrencyCode,
    exponent,
  );
  if (input.source !== 'custom') {
    return {
      version: 1,
      source: input.source,
      ...normalized,
      customReason: null,
      adjustment: null,
    };
  }

  const reason = input.customReason?.trim();
  if (!reason) {
    throw new BadRequestException('A reason is required for a custom accepted price');
  }
  let custom: Decimal;
  try {
    custom = new Decimal(input.customTotal ?? '');
  } catch {
    throw new BadRequestException('Custom accepted total must be valid money');
  }
  if (!custom.isFinite() || custom.lessThanOrEqualTo(0)) {
    throw new BadRequestException('Custom accepted total must be greater than zero');
  }
  if (custom.decimalPlaces() > exponent) {
    throw new BadRequestException(
      `Custom accepted total has fractional minor units for ${input.requestCurrencyCode.toUpperCase()}`,
    );
  }
  const adjustment = custom.minus(normalized['grandTotal']).toDecimalPlaces(2);
  return {
    version: 1,
    source: 'custom',
    ...normalized,
    grandTotal: custom.toFixed(2),
    customReason: reason,
    adjustment: adjustment.isZero()
      ? null
      : {
          amount: adjustment.toFixed(2),
          reason,
          serviceDate: normalized['nights'][0]!.date,
        },
  };
}
