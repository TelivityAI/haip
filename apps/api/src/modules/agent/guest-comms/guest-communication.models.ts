/**
 * Guest Communication Agent — template-based lifecycle emails.
 *
 * NOT LLM-generated freeform text. Templates with smart slot filling.
 * Predictable, auditable, no hallucination risk.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailType =
  | 'confirmation'
  | 'pre_arrival'
  | 'day_of'
  | 'welcome'
  | 'post_stay'
  | 'win_back';

export interface GuestContext {
  firstName: string;
  lastName: string;
  email: string;
  vipLevel: string;
  isRepeatGuest: boolean;
  pastStayCount: number;
  gdprConsentMarketing: boolean;
  preferences?: Record<string, string>;
}

export interface ReservationContext {
  id: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  roomTypeName: string;
  ratePlanName: string;
  totalAmount: string;
  currencyCode: string;
  specialRequests?: string;
  confirmationNumber: string;
}

export interface PropertyContext {
  name: string;
  checkInTime: string;
  checkOutTime: string;
  phone?: string;
  email?: string;
  website?: string;
  addressLine1?: string;
  city?: string;
}

export interface EmailDraft {
  emailType: EmailType;
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  personalizationTokens: string[];
}

export interface CommunicationConfig {
  enabledTypes: EmailType[];
  preArrivalDaysBefore: number;
  postStayDelayHours: number;
  winBackDays: number;
  reviewLinkGoogle?: string;
  reviewLinkTripadvisor?: string;
  upsellEnabled: boolean;
  localTips: string[];
  managerName?: string;
  managerTitle?: string;
}

// ---------------------------------------------------------------------------
// Template slot filling
// ---------------------------------------------------------------------------

export function fillTemplate(template: string, tokens: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(tokens)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Subject lines
// ---------------------------------------------------------------------------

const SUBJECTS: Record<EmailType, string> = {
  confirmation: 'Booking Confirmed — {property_name}',
  pre_arrival: 'Your Stay at {property_name} is Coming Up!',
  day_of: 'Today is the Day — Welcome to {property_name}',
  welcome: 'Welcome to {property_name}, {first_name}!',
  post_stay: 'Thank You for Staying at {property_name}',
  win_back: 'We Miss You, {first_name}! A Special Offer from {property_name}',
};

// ---------------------------------------------------------------------------
// Body templates (plain text — HTML wraps this)
// ---------------------------------------------------------------------------

const BODY_TEMPLATES: Record<EmailType, { firstTime: string; repeat: string }> = {
  confirmation: {
    firstTime: [
      'Dear {first_name},',
      '',
      'Thank you for choosing {property_name}! Your reservation is confirmed.',
      '',
      'Confirmation: {confirmation_number}',
      'Check-in: {arrival_date} at {check_in_time}',
      'Check-out: {departure_date} at {check_out_time}',
      'Room: {room_type}',
      'Rate: {total_amount} {currency}',
      '{special_requests_line}',
      '',
      'We look forward to welcoming you.',
      '',
      'Best regards,',
      '{property_name}',
    ].join('\n'),
    repeat: [
      'Dear {first_name},',
      '',
      'Welcome back! We\'re delighted to confirm your return to {property_name}.',
      '',
      'Confirmation: {confirmation_number}',
      'Check-in: {arrival_date} at {check_in_time}',
      'Check-out: {departure_date} at {check_out_time}',
      'Room: {room_type}',
      'Rate: {total_amount} {currency}',
      '{special_requests_line}',
      '',
      'As a returning guest, we\'ll make sure everything is just the way you like it.',
      '',
      'See you soon,',
      '{property_name}',
    ].join('\n'),
  },
  pre_arrival: {
    firstTime: [
      'Dear {first_name},',
      '',
      'Your stay at {property_name} is just {days_until} days away!',
      '',
      'Here\'s what you need to know:',
      '- Check-in time: {check_in_time}',
      '- Address: {property_address}',
      '{local_tips_section}',
      '{upsell_section}',
      '',
      'If you have any questions, contact us at {property_phone} or {property_email}.',
      '',
      'We look forward to meeting you!',
      '{property_name}',
    ].join('\n'),
    repeat: [
      'Dear {first_name},',
      '',
      'Welcome back in {days_until} days! We\'re preparing for your return to {property_name}.',
      '',
      'Quick reminder:',
      '- Check-in: {check_in_time}',
      '{local_tips_section}',
      '{upsell_section}',
      '',
      'We look forward to seeing you again.',
      '{property_name}',
    ].join('\n'),
  },
  day_of: {
    firstTime: [
      'Dear {first_name},',
      '',
      'Today is the day! We\'re ready to welcome you at {property_name}.',
      '',
      'Check-in is available from {check_in_time}.',
      '{property_address}',
      '',
      'See you soon!',
      '{property_name}',
    ].join('\n'),
    repeat: [
      'Dear {first_name},',
      '',
      'Welcome back today! Your room at {property_name} is ready for you.',
      '',
      'Check-in from {check_in_time} as usual.',
      '',
      'See you shortly!',
      '{property_name}',
    ].join('\n'),
  },
  welcome: {
    firstTime: [
      'Dear {first_name},',
      '',
      'Welcome to {property_name}! We\'re excited to have you.',
      '',
      'A few things to make your stay comfortable:',
      '- Wi-Fi network: {property_name} Guest',
      '- Front desk: {property_phone}',
      '- Check-out: {check_out_time}',
      '',
      'Don\'t hesitate to contact us if you need anything.',
      '',
      'Enjoy your stay!',
      '{property_name}',
    ].join('\n'),
    repeat: [
      'Dear {first_name},',
      '',
      'Welcome back to {property_name}! It\'s great to have you with us again.',
      '',
      'As always:',
      '- Front desk: {property_phone}',
      '- Check-out: {check_out_time}',
      '',
      'Enjoy your stay!',
      '{property_name}',
    ].join('\n'),
  },
  post_stay: {
    firstTime: [
      'Dear {first_name},',
      '',
      'Thank you for staying at {property_name}. We hope you enjoyed your visit!',
      '',
      'We\'d love to hear your feedback:',
      '{review_links}',
      '',
      'We hope to welcome you again soon.',
      '',
      'Warm regards,',
      '{property_name}',
    ].join('\n'),
    repeat: [
      'Dear {first_name},',
      '',
      'Thank you for choosing {property_name} once again — it\'s always a pleasure to host you.',
      '',
      'If you have a moment, your review would mean a lot:',
      '{review_links}',
      '',
      'Until next time,',
      '{property_name}',
    ].join('\n'),
  },
  win_back: {
    firstTime: [
      'Dear {first_name},',
      '',
      'It\'s been a while since your stay at {property_name}, and we\'d love to see you again!',
      '',
      'Book your next visit and discover what\'s new.',
      '{property_website}',
      '',
      'We hope to welcome you back soon.',
      '{property_name}',
    ].join('\n'),
    repeat: [
      'Dear {first_name},',
      '',
      'We miss you at {property_name}! It\'s been {days_since} days since your last stay.',
      '',
      'As a valued returning guest, we\'d love to welcome you again.',
      '{property_website}',
      '',
      'Hope to see you soon!',
      '{property_name}',
    ].join('\n'),
  },
};

// ---------------------------------------------------------------------------
// Email generation
// ---------------------------------------------------------------------------

export function generateEmailDraft(
  emailType: EmailType,
  guest: GuestContext,
  reservation: ReservationContext,
  property: PropertyContext,
  config: CommunicationConfig,
  previousEmailTypes: EmailType[] = [],
): EmailDraft | null {
  // GDPR: check opt-out
  if (!guest.gdprConsentMarketing && emailType !== 'confirmation') {
    return null;
  }

  // No duplicate: check if this type was already sent for this reservation
  if (previousEmailTypes.includes(emailType)) {
    return null;
  }

  const isRepeat = guest.isRepeatGuest;
  const templates = BODY_TEMPLATES[emailType];
  const bodyTemplate = isRepeat ? templates.repeat : templates.firstTime;

  // Build token map
  const daysUntilArrival = Math.max(0, Math.ceil(
    (new Date(reservation.arrivalDate).getTime() - Date.now()) / 86400000,
  ));

  const tokens: Record<string, string> = {
    first_name: guest.firstName,
    last_name: guest.lastName,
    property_name: property.name,
    confirmation_number: reservation.confirmationNumber,
    arrival_date: reservation.arrivalDate,
    departure_date: reservation.departureDate,
    nights: String(reservation.nights),
    room_type: reservation.roomTypeName,
    total_amount: reservation.totalAmount,
    currency: reservation.currencyCode,
    check_in_time: property.checkInTime,
    check_out_time: property.checkOutTime,
    property_phone: property.phone ?? '',
    property_email: property.email ?? '',
    property_address: [property.addressLine1, property.city].filter(Boolean).join(', '),
    property_website: property.website ?? '',
    days_until: String(daysUntilArrival),
    days_since: '90', // default for win_back
    special_requests_line: reservation.specialRequests
      ? `Special requests: ${reservation.specialRequests}`
      : '',
    local_tips_section: config.localTips.length > 0
      ? '\nLocal tips:\n' + config.localTips.slice(0, 3).map((t) => `- ${t}`).join('\n')
      : '',
    upsell_section: config.upsellEnabled
      ? '\nEnhance your stay — ask us about breakfast, parking, spa, and other extras when you arrive, or reply to this email to add them before check-in.\n'
      : '',
    review_links: buildReviewLinks(config),
  };

  const personalizationTokens: string[] = ['first_name', 'room_type'];
  if (isRepeat) personalizationTokens.push('repeat_guest');
  if (guest.vipLevel !== 'none') personalizationTokens.push('vip_level');

  const subject = fillTemplate(SUBJECTS[emailType], tokens);
  const bodyText = fillTemplate(bodyTemplate, tokens);
  const bodyHtml = textToHtml(bodyText);

  return {
    emailType,
    to: guest.email,
    subject,
    bodyHtml,
    bodyText,
    personalizationTokens,
  };
}

function buildReviewLinks(config: CommunicationConfig): string {
  const links: string[] = [];
  if (config.reviewLinkGoogle) links.push(`- Google: ${config.reviewLinkGoogle}`);
  if (config.reviewLinkTripadvisor) links.push(`- TripAdvisor: ${config.reviewLinkTripadvisor}`);
  if (links.length === 0) links.push('- We appreciate your feedback!');
  return links.join('\n');
}

function textToHtml(text: string): string {
  return '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">' +
    text
      .split('\n')
      .map((line) => (line.trim() === '' ? '<br/>' : `<p style="margin: 4px 0;">${escapeHtml(line)}</p>`))
      .join('\n') +
    '</div>';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Determine which email type to trigger from an event
// ---------------------------------------------------------------------------

export function getEmailTypeForEvent(eventName: string): EmailType | null {
  switch (eventName) {
    case 'reservation.created': return 'confirmation';
    case 'reservation.checked_in': return 'welcome';
    case 'reservation.checked_out': return 'post_stay';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export function getDefaultCommunicationConfig(): CommunicationConfig {
  return {
    enabledTypes: ['confirmation', 'pre_arrival', 'post_stay'],
    preArrivalDaysBefore: 3,
    postStayDelayHours: 24,
    winBackDays: 90,
    upsellEnabled: true,
    localTips: [],
  };
}
