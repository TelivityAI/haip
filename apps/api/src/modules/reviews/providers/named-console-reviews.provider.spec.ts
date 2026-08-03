import { describe, expect, it } from 'vitest';
import {
  NamedConsoleReviewsProvider,
  WAVE_REVIEW_CONSOLE_PACKS,
} from './named-console-reviews.provider';

describe('WAVE_REVIEW_CONSOLE_PACKS', () => {
  it('registers nine Wave 3 review consoles', () => {
    expect(WAVE_REVIEW_CONSOLE_PACKS).toHaveLength(9);
    expect(WAVE_REVIEW_CONSOLE_PACKS.map((p) => p.key)).toContain('trustyou');
    expect(WAVE_REVIEW_CONSOLE_PACKS.map((p) => p.key)).toContain('foursquare-places');
  });
});

describe('NamedConsoleReviewsProvider', () => {
  it('logs console handoff without vendor HTTP', async () => {
    const provider = new NamedConsoleReviewsProvider('trustyou', 'TrustYou');
    expect(provider.name).toBe('trustyou');
    expect(provider.isConfigured({ propertyId: 'prop-1' })).toBe(true);

    const result = await provider.pullReviews({ propertyId: 'prop-1' });
    expect(result.pulled).toBe(false);
    expect(result.provider).toBe('trustyou');
    expect(result.reviews).toEqual([]);
  });
});
