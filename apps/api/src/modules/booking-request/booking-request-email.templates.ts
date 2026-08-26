export type BookingRequestEmailContent = {
  subject: string;
  bodyText: string;
};

type StayEmailInput = {
  guestFirstName: string;
  arrivalDate: string;
  departureDate: string;
};

type MoneyEmailInput = {
  guestFirstName: string;
  amount: string;
  currencyCode: string;
};

function greeting(guestFirstName: string): string {
  const name = guestFirstName.trim();
  return name ? `Hello ${name},` : 'Hello,';
}

function money(amount: string, currencyCode: string): string {
  return `${amount} ${currencyCode.trim().toUpperCase()}`;
}

export function requestReceivedEmail(input: StayEmailInput): BookingRequestEmailContent {
  return {
    subject: 'We received your booking request',
    bodyText: [
      greeting(input.guestFirstName),
      '',
      `We received your booking request for ${input.arrivalDate} to ${input.departureDate}.`,
      'The property will review it and contact you with a decision.',
      'This message does not confirm a reservation.',
    ].join('\n'),
  };
}

export function acceptedBookingRequestEmail(
  input: StayEmailInput & { acceptedTotal: string; currencyCode: string },
): BookingRequestEmailContent {
  return {
    subject: 'Your booking request was accepted',
    bodyText: [
      greeting(input.guestFirstName),
      '',
      `Your booking request for ${input.arrivalDate} to ${input.departureDate} was accepted.`,
      `Accepted stay total: ${money(input.acceptedTotal, input.currencyCode)}.`,
      'The property will contact you if any further information is needed.',
    ].join('\n'),
  };
}

export function deniedBookingRequestEmail(input: StayEmailInput): BookingRequestEmailContent {
  return {
    subject: 'Your booking request was not accepted',
    bodyText: [
      greeting(input.guestFirstName),
      '',
      `The property was unable to accept your booking request for ${input.arrivalDate} to ${input.departureDate}.`,
      'No reservation was created from this request.',
    ].join('\n'),
  };
}

export function paymentReceivedBookingRequestEmail(
  input: MoneyEmailInput & { source: 'saved_card' | 'external' },
): BookingRequestEmailContent {
  const description = input.source === 'external'
    ? 'A payment collected by the property was recorded'
    : 'Your payment was received';
  return {
    subject: 'Payment received for your booking',
    bodyText: [
      greeting(input.guestFirstName),
      '',
      `${description}: ${money(input.amount, input.currencyCode)}.`,
      'Thank you.',
    ].join('\n'),
  };
}

export function refundedBookingRequestPaymentEmail(
  input: MoneyEmailInput & { source: 'refund' | 'external_return' },
): BookingRequestEmailContent {
  const description = input.source === 'external_return'
    ? 'The property recorded a returned payment'
    : 'A refund was completed';
  return {
    subject: 'Payment returned for your booking',
    bodyText: [
      greeting(input.guestFirstName),
      '',
      `${description}: ${money(input.amount, input.currencyCode)}.`,
      'Processing time at your financial institution may vary.',
    ].join('\n'),
  };
}

export function failedBookingRequestPaymentEmail(
  input: MoneyEmailInput & { operation: 'charge' | 'refund' },
): BookingRequestEmailContent {
  const description = input.operation === 'refund'
    ? 'A payment return could not be completed'
    : 'A payment attempt was not successful';
  return {
    subject: input.operation === 'refund'
      ? 'Payment return was not completed'
      : 'Payment was not completed',
    bodyText: [
      greeting(input.guestFirstName),
      '',
      `${description}: ${money(input.amount, input.currencyCode)}.`,
      'Please contact the property if you need assistance.',
    ].join('\n'),
  };
}
