import { classifyHaipMetadata } from './stripe-financial-state';

describe('Stripe financial metadata classification', () => {
  it('classifies HAIP-owned vs external PaymentIntent metadata', () => {
    expect(classifyHaipMetadata({})).toBe('external');
    expect(classifyHaipMetadata({ unrelated: 'value' })).toBe('external');
    expect(classifyHaipMetadata({ haip_payment_id: 'payment-1' })).toBe('owned-valid');
    expect(classifyHaipMetadata({ haip_payment_id: '' })).toBe('owned-malformed');
  });
});
