import { describe, it, expect, vi } from 'vitest';
import { ReviewsService } from './reviews.service';
import type { ReviewSourceProvider } from './review-source.interface';

describe('ReviewsService', () => {
  it('uses google provider when configured', async () => {
    const google: ReviewSourceProvider = {
      name: 'google',
      isConfigured: () => true,
      pullReviews: vi.fn().mockResolvedValue({
        pulled: true,
        provider: 'google',
        reviews: [],
      }),
    };
    const consoleProvider: ReviewSourceProvider = {
      name: 'console',
      isConfigured: () => true,
      pullReviews: vi.fn(),
    };
    const tripadvisor: ReviewSourceProvider = {
      name: 'tripadvisor',
      isConfigured: () => false,
      pullReviews: vi.fn(),
    };

    const service = new ReviewsService([google, tripadvisor, consoleProvider]);
    await service.pullReviews('prop-1', 'google', { placeId: 'ChIJ' });
    expect(google.pullReviews).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-1', placeId: 'ChIJ' }),
    );
  });

  it('falls back to console when source credentials missing', async () => {
    const google: ReviewSourceProvider = {
      name: 'google',
      isConfigured: () => false,
      pullReviews: vi.fn(),
    };
    const consoleProvider: ReviewSourceProvider = {
      name: 'console',
      isConfigured: () => true,
      pullReviews: vi.fn().mockResolvedValue({
        pulled: false,
        provider: 'console',
        reviews: [],
      }),
    };
    const tripadvisor: ReviewSourceProvider = {
      name: 'tripadvisor',
      isConfigured: () => false,
      pullReviews: vi.fn(),
    };

    const service = new ReviewsService([google, tripadvisor, consoleProvider]);
    await service.pullReviews('prop-1', 'google');
    expect(consoleProvider.pullReviews).toHaveBeenCalled();
    expect(google.pullReviews).not.toHaveBeenCalled();
  });

  it('uses named Wave 3 console review pack when requested', async () => {
    const trustyou: ReviewSourceProvider = {
      name: 'trustyou',
      isConfigured: () => true,
      pullReviews: vi.fn().mockResolvedValue({
        pulled: false,
        provider: 'trustyou',
        reviews: [],
      }),
    };
    const consoleProvider: ReviewSourceProvider = {
      name: 'console',
      isConfigured: () => true,
      pullReviews: vi.fn(),
    };
    const google: ReviewSourceProvider = {
      name: 'google',
      isConfigured: () => false,
      pullReviews: vi.fn(),
    };
    const tripadvisor: ReviewSourceProvider = {
      name: 'tripadvisor',
      isConfigured: () => false,
      pullReviews: vi.fn(),
    };

    const service = new ReviewsService([google, tripadvisor, trustyou, consoleProvider]);
    await service.pullReviews('prop-1', 'trustyou');
    expect(trustyou.pullReviews).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-1' }),
    );
    expect(consoleProvider.pullReviews).not.toHaveBeenCalled();
  });
});
