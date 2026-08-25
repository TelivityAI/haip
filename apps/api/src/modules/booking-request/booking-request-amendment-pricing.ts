import { ConflictException } from '@nestjs/common';
import type {
  AcceptedPricingService,
  AcceptedPricingServiceNight,
  AcceptedPricingSnapshot,
} from '@telivityhaip/database';
import Decimal from 'decimal.js';
import { stayDates } from '../reservation/availability.service';
import { buildAcceptedPricingSnapshot } from './booking-request-pricing';

export type StayAmendmentPriceSource = 'prior' | 'current' | 'custom';

type BuildAmendedPricingInput = {
  source: StayAmendmentPriceSource;
  previous: AcceptedPricingSnapshot;
  currentQuote: unknown;
  currencyCode: string;
  arrivalDate: string;
  departureDate: string;
  customTotal?: string;
  customReason?: string;
};

function nearestBoundaryLine<T extends { date: string }>(lines: T[], date: string): T {
  const ordered = [...lines].sort((left, right) => left.date.localeCompare(right.date));
  const exact = ordered.find((line) => line.date === date);
  if (exact) return exact;
  const boundary = date < ordered[0]!.date ? ordered[0] : ordered.at(-1);
  if (!boundary) throw new ConflictException('Prior pricing has no immutable posting basis');
  return boundary;
}

function sum(
  values: Array<string>,
): string {
  return values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed(2);
}

/**
 * Convert the immutable accepted snapshot into the current operational basis.
 * Cancellation is authoritative for scheduling, so its money must leave every
 * aggregate before prior/current/custom amendment choices are calculated.
 */
export function withoutCancelledAcceptedServices(
  previous: AcceptedPricingSnapshot,
  cancelledServiceIds: ReadonlySet<string>,
): AcceptedPricingSnapshot {
  const services = previous.services
    .filter((service) => !cancelledServiceIds.has(service.serviceId))
    .map((service) => structuredClone(service));
  const servicesTotal = sum(services.map((service) => service.lineTotal));
  const servicesTaxTotal = sum(services.map((service) => service.taxTotal));
  const grandTotal = new Decimal(previous.roomTotal)
    .plus(previous.taxTotal)
    .plus(servicesTotal)
    .plus(servicesTaxTotal)
    .plus(previous.adjustment?.amount ?? 0)
    .toFixed(2);
  return {
    ...structuredClone(previous),
    services,
    servicesTotal,
    servicesTaxTotal,
    grandTotal,
  };
}

function priorService(
  service: AcceptedPricingService,
  dates: string[],
): AcceptedPricingService {
  if (service.currencyCode.length !== 3) {
    throw new ConflictException(`Prior service ${service.code} has no valid currency`);
  }
  if (service.postingRule === 'on_consumption') return structuredClone(service);
  if (!service.lineItems.length) {
    throw new ConflictException(`Prior service ${service.code} has no immutable posting basis`);
  }

  let lineItems: AcceptedPricingServiceNight[];
  if (service.postingRule === 'per_night') {
    lineItems = dates.map((date) => {
      const basis = nearestBoundaryLine(service.lineItems, date);
      return { ...basis, date };
    });
  } else {
    const basis = service.lineItems[0]!;
    lineItems = [{
      ...basis,
      date: dates.includes(basis.date) ? basis.date : dates[0]!,
    }];
  }
  return {
    ...structuredClone(service),
    quantity: service.postingRule === 'per_night' ? dates.length : service.quantity,
    lineTotal: sum(lineItems.map((line) => line.amount)),
    taxTotal: sum(lineItems.map((line) => line.taxAmount)),
    lineItems,
  };
}

/**
 * Derive a prior-rate stay without consulting live catalog state.
 * Existing dates keep their exact immutable lines. A date extending before or
 * after the old window copies the nearest accepted boundary line. Per-night
 * services use the same rule; fixed service/adjustment amounts stay fixed and
 * move to the new arrival only when their old service date was removed.
 */
export function buildPriorAmendedPricingSnapshot(
  previous: AcceptedPricingSnapshot,
  arrivalDate: string,
  departureDate: string,
): AcceptedPricingSnapshot {
  const dates = stayDates(arrivalDate, departureDate);
  if (!previous.nights?.length) {
    throw new ConflictException('Reservation has no immutable prior nightly basis');
  }
  const nights = dates.map((date) => {
    const basis = nearestBoundaryLine(previous.nights, date);
    return { ...basis, date };
  });
  const services = previous.services.map((service) => {
    if (service.currencyCode !== previous.currencyCode) {
      throw new ConflictException(
        `Prior service currency ${service.currencyCode} does not match ${previous.currencyCode}`,
      );
    }
    return priorService(service, dates);
  });
  const roomTotal = sum(nights.map((night) => night.roomAmount));
  const taxTotal = sum(nights.map((night) => night.taxAmount));
  const servicesTotal = sum(services.map((service) => service.lineTotal));
  const servicesTaxTotal = sum(services.map((service) => service.taxTotal));
  const adjustment = previous.adjustment
    ? {
        ...structuredClone(previous.adjustment),
        serviceDate: dates.includes(previous.adjustment.serviceDate)
          ? previous.adjustment.serviceDate
          : dates[0]!,
      }
    : null;
  const grandTotal = new Decimal(roomTotal)
    .plus(taxTotal)
    .plus(servicesTotal)
    .plus(servicesTaxTotal)
    .plus(adjustment?.amount ?? 0)
    .toFixed(2);
  if (new Decimal(grandTotal).lessThanOrEqualTo(0)) {
    throw new ConflictException('Prior pricing produces a non-positive amended total');
  }
  return {
    version: 1,
    source: 'prior',
    currencyCode: previous.currencyCode,
    grandTotal,
    roomTotal,
    taxTotal,
    nights,
    services,
    servicesTotal,
    servicesTaxTotal,
    customReason: previous.customReason,
    adjustment,
  };
}

export function buildAmendedPricingSnapshot(
  input: BuildAmendedPricingInput,
): AcceptedPricingSnapshot {
  const quoteCurrency = (
    input.currentQuote && typeof input.currentQuote === 'object'
      ? (input.currentQuote as Record<string, unknown>)['currencyCode']
      : undefined
  );
  if (input.previous.currencyCode !== input.currencyCode) {
    throw new ConflictException('Prior pricing currency does not match the reservation currency');
  }
  if (quoteCurrency !== input.currencyCode) {
    throw new ConflictException('Current quote currency does not match the reservation currency');
  }
  if (input.source === 'prior') {
    return buildPriorAmendedPricingSnapshot(
      input.previous,
      input.arrivalDate,
      input.departureDate,
    );
  }
  return buildAcceptedPricingSnapshot({
    source: input.source,
    requestCurrencyCode: input.currencyCode,
    submittedQuote: input.currentQuote,
    currentQuote: input.currentQuote,
    customTotal: input.customTotal,
    customReason: input.customReason,
  });
}
