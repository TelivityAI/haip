export const REQUEST_CARD_CONSENT_VERSION = 'request-card-v1';

export function requestCardConsent(propertyName: string): string {
  return `I authorize ${propertyName} to securely save this payment method and charge amounts explicitly recorded against this stay. I understand no charge is made when submitting.`;
}
