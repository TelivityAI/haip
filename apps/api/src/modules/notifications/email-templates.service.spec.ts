import { describe, expect, it } from 'vitest';
import {
  EMAIL_TEMPLATE_TOKENS,
  EMAIL_TYPES,
  unknownTemplateTokens,
} from './email-templates.service';
import { generateEmailDraft, getDefaultCommunicationConfig } from '../agent/guest-comms/guest-communication.models';

const guest = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  vipLevel: 'none',
  isRepeatGuest: false,
  pastStayCount: 0,
  gdprConsentMarketing: true,
};

const reservation = {
  id: 'res-1',
  arrivalDate: '2026-12-01',
  departureDate: '2026-12-03',
  nights: 2,
  roomTypeName: 'Deluxe Double',
  ratePlanName: 'BAR',
  totalAmount: '320.00',
  currencyCode: 'USD',
  confirmationNumber: 'CONF-1',
};

const property = {
  name: 'Example Hotel',
  checkInTime: '16:00',
  checkOutTime: '11:00',
};

describe('unknownTemplateTokens', () => {
  it('accepts every documented token', () => {
    const text = EMAIL_TEMPLATE_TOKENS.map((t) => `{${t}}`).join(' ');
    expect(unknownTemplateTokens(text)).toEqual([]);
  });

  it('reports unknown tokens so a guest never receives a literal brace', () => {
    expect(unknownTemplateTokens('Hi {first_name}, see {totally_made_up}')).toEqual([
      'totally_made_up',
    ]);
  });
});

describe('email template override', () => {
  it('uses the built-in copy when no override exists', () => {
    const draft = generateEmailDraft(
      'confirmation',
      guest,
      reservation,
      property,
      getDefaultCommunicationConfig(),
    );
    expect(draft?.subject).toContain('Example Hotel');
    expect(draft?.bodyText).toContain('Ada');
  });

  it('prefers a per-property override and still fills tokens', () => {
    const config = {
      ...getDefaultCommunicationConfig(),
      customTemplates: {
        confirmation: {
          subject: 'See you at {property_name}, {first_name}',
          firstTime: 'Dear {first_name}, booking {confirmation_number} is confirmed.',
        },
      },
    };
    const draft = generateEmailDraft('confirmation', guest, reservation, property, config);
    expect(draft?.subject).toBe('See you at Example Hotel, Ada');
    expect(draft?.bodyText).toBe('Dear Ada, booking CONF-1 is confirmed.');
  });

  it('leaves the repeat body on the default when only the first-time body is overridden', () => {
    const config = {
      ...getDefaultCommunicationConfig(),
      customTemplates: { confirmation: { firstTime: 'Custom first time' } },
    };
    const repeatGuest = { ...guest, isRepeatGuest: true };
    const draft = generateEmailDraft('confirmation', repeatGuest, reservation, property, config);
    expect(draft?.bodyText).not.toBe('Custom first time');
    expect(draft?.bodyText).toContain('Welcome back');
  });

  it('knows all six lifecycle types', () => {
    expect([...EMAIL_TYPES]).toEqual([
      'confirmation',
      'pre_arrival',
      'day_of',
      'welcome',
      'post_stay',
      'win_back',
    ]);
  });
});
