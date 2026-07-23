import { describe, it, expect } from 'vitest';
import {
  fillTemplate,
  generateEmailDraft,
  getEmailTypeForEvent,
  getDefaultCommunicationConfig,
  type GuestContext,
  type ReservationContext,
  type PropertyContext,
  type CommunicationConfig,
} from './guest-communication.models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGuest(overrides: Partial<GuestContext> = {}): GuestContext {
  return {
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    vipLevel: 'none',
    isRepeatGuest: false,
    pastStayCount: 0,
    gdprConsentMarketing: true,
    ...overrides,
  };
}

function makeReservation(overrides: Partial<ReservationContext> = {}): ReservationContext {
  return {
    id: 'res-1',
    arrivalDate: '2026-04-15',
    departureDate: '2026-04-18',
    nights: 3,
    roomTypeName: 'Deluxe King',
    ratePlanName: 'Best Available',
    totalAmount: '450.00',
    currencyCode: 'USD',
    confirmationNumber: 'CONF-12345',
    ...overrides,
  };
}

function makeProperty(overrides: Partial<PropertyContext> = {}): PropertyContext {
  return {
    name: 'Telivity Grand Hotel',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    phone: '+1-555-0100',
    email: 'info@telivity.com',
    website: 'https://telivity.com',
    addressLine1: '123 Main St',
    city: 'New York',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<CommunicationConfig> = {}): CommunicationConfig {
  return {
    ...getDefaultCommunicationConfig(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fillTemplate
// ---------------------------------------------------------------------------

describe('fillTemplate', () => {
  it('replaces tokens in template', () => {
    const result = fillTemplate('Hello {name}, welcome to {place}!', {
      name: 'Alice',
      place: 'Hotel',
    });
    expect(result).toBe('Hello Alice, welcome to Hotel!');
  });

  it('replaces multiple occurrences of same token', () => {
    const result = fillTemplate('{x} and {x}', { x: 'A' });
    expect(result).toBe('A and A');
  });

  it('leaves unknown tokens untouched', () => {
    const result = fillTemplate('{known} {unknown}', { known: 'yes' });
    expect(result).toBe('yes {unknown}');
  });
});

// ---------------------------------------------------------------------------
// generateEmailDraft
// ---------------------------------------------------------------------------

describe('generateEmailDraft', () => {
  it('generates confirmation email for first-time guest', () => {
    const draft = generateEmailDraft(
      'confirmation',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig(),
    );
    expect(draft).not.toBeNull();
    expect(draft!.emailType).toBe('confirmation');
    expect(draft!.to).toBe('alice@example.com');
    expect(draft!.subject).toContain('Booking Confirmed');
    expect(draft!.bodyText).toContain('Alice');
    expect(draft!.bodyText).toContain('CONF-12345');
    expect(draft!.bodyText).toContain('Deluxe King');
  });

  it('generates different content for repeat guest', () => {
    const firstTimer = generateEmailDraft(
      'confirmation',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig(),
    );
    const repeat = generateEmailDraft(
      'confirmation',
      makeGuest({ isRepeatGuest: true, pastStayCount: 3 }),
      makeReservation(),
      makeProperty(),
      makeConfig(),
    );
    expect(firstTimer!.bodyText).toContain('Thank you for choosing');
    expect(repeat!.bodyText).toContain('Welcome back');
    expect(repeat!.personalizationTokens).toContain('repeat_guest');
  });

  it('blocks non-confirmation emails when GDPR opt-out', () => {
    const guest = makeGuest({ gdprConsentMarketing: false });
    const confirmation = generateEmailDraft('confirmation', guest, makeReservation(), makeProperty(), makeConfig());
    const preArrival = generateEmailDraft('pre_arrival', guest, makeReservation(), makeProperty(), makeConfig());
    const postStay = generateEmailDraft('post_stay', guest, makeReservation(), makeProperty(), makeConfig());

    expect(confirmation).not.toBeNull(); // confirmation always sent
    expect(preArrival).toBeNull();
    expect(postStay).toBeNull();
  });

  it('prevents duplicate emails for same event', () => {
    const draft = generateEmailDraft(
      'confirmation',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig(),
      ['confirmation'], // already sent
    );
    expect(draft).toBeNull();
  });

  it('includes local tips in pre-arrival email', () => {
    const config = makeConfig({
      localTips: ['Best coffee: Café Luna', 'Free parking in Lot B'],
    });
    const draft = generateEmailDraft(
      'pre_arrival',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      config,
    );
    expect(draft!.bodyText).toContain('Café Luna');
    expect(draft!.bodyText).toContain('Lot B');
  });

  it('includes upsell section in pre-arrival when enabled', () => {
    const draft = generateEmailDraft(
      'pre_arrival',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig({ upsellEnabled: true }),
    );
    expect(draft!.bodyText).toContain('Enhance your stay');
    expect(draft!.bodyText).toContain('breakfast, parking, spa');
  });

  it('omits upsell section in pre-arrival when disabled', () => {
    const draft = generateEmailDraft(
      'pre_arrival',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig({ upsellEnabled: false }),
    );
    expect(draft!.bodyText).not.toContain('Enhance your stay');
  });

  it('includes review links in post-stay email', () => {
    const config = makeConfig({
      reviewLinkGoogle: 'https://g.page/r/test',
      reviewLinkTripadvisor: 'https://tripadvisor.com/test',
    });
    const draft = generateEmailDraft(
      'post_stay',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      config,
    );
    expect(draft!.bodyText).toContain('g.page');
    expect(draft!.bodyText).toContain('tripadvisor.com');
  });

  it('generates welcome email with property info', () => {
    const draft = generateEmailDraft(
      'welcome',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig(),
    );
    expect(draft!.bodyText).toContain('Wi-Fi');
    expect(draft!.bodyText).toContain('+1-555-0100');
    expect(draft!.bodyText).toContain('11:00');
  });

  it('includes HTML wrapper in bodyHtml', () => {
    const draft = generateEmailDraft(
      'confirmation',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig(),
    );
    expect(draft!.bodyHtml).toContain('<div');
    expect(draft!.bodyHtml).toContain('font-family');
  });

  it('adds VIP token for VIP guests', () => {
    const draft = generateEmailDraft(
      'confirmation',
      makeGuest({ vipLevel: 'gold' }),
      makeReservation(),
      makeProperty(),
      makeConfig(),
    );
    expect(draft!.personalizationTokens).toContain('vip_level');
  });

  it('includes special requests in confirmation', () => {
    const draft = generateEmailDraft(
      'confirmation',
      makeGuest(),
      makeReservation({ specialRequests: 'Extra pillows please' }),
      makeProperty(),
      makeConfig(),
    );
    expect(draft!.bodyText).toContain('Extra pillows');
  });

  it('generates win_back email', () => {
    const draft = generateEmailDraft(
      'win_back',
      makeGuest(),
      makeReservation(),
      makeProperty(),
      makeConfig(),
    );
    expect(draft!.emailType).toBe('win_back');
    expect(draft!.bodyText).toContain('Telivity Grand Hotel');
  });
});

// ---------------------------------------------------------------------------
// getEmailTypeForEvent
// ---------------------------------------------------------------------------

describe('getEmailTypeForEvent', () => {
  it('maps reservation.created to confirmation', () => {
    expect(getEmailTypeForEvent('reservation.created')).toBe('confirmation');
  });

  it('maps reservation.checked_in to welcome', () => {
    expect(getEmailTypeForEvent('reservation.checked_in')).toBe('welcome');
  });

  it('maps reservation.checked_out to post_stay', () => {
    expect(getEmailTypeForEvent('reservation.checked_out')).toBe('post_stay');
  });

  it('returns null for unknown events', () => {
    expect(getEmailTypeForEvent('folio.charge_posted')).toBeNull();
  });
});
