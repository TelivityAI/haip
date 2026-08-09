import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewsService } from './reviews.service';
import type { ReviewSourceProvider } from './review-source.interface';

describe('ReviewsService', () => {
  const ingestService = {
    ingestFromPullItems: vi.fn().mockResolvedValue({
      imported: 1,
      updated: 0,
      newReviewIds: ['r1'],
    }),
  };
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ingestService.ingestFromPullItems.mockResolvedValue({
      imported: 1,
      updated: 0,
      newReviewIds: ['r1'],
    });
  });

  it('uses google provider when configured and persists pull', async () => {
    const google: ReviewSourceProvider = {
      name: 'google',
      isConfigured: () => true,
      pullReviews: vi.fn().mockResolvedValue({
        pulled: true,
        provider: 'google',
        reviews: [
          {
            externalId: 'g-1',
            guestName: 'A',
            rating: 5,
            reviewText: 'Nice',
            source: 'google',
          },
        ],
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

    const service = new ReviewsService(
      [google, tripadvisor, consoleProvider],
      ingestService as any,
      db as any,
    );
    const result = await service.pullReviews('prop-1', 'google', { placeId: 'ChIJ' });
    expect(google.pullReviews).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-1', placeId: 'ChIJ' }),
    );
    expect(ingestService.ingestFromPullItems).toHaveBeenCalled();
    expect(result.imported).toBe(1);
    expect(result.newReviewIds).toEqual(['r1']);
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

    const service = new ReviewsService(
      [google, tripadvisor, consoleProvider],
      ingestService as any,
      db as any,
    );
    await service.pullReviews('prop-1', 'google');
    expect(consoleProvider.pullReviews).toHaveBeenCalled();
    expect(google.pullReviews).not.toHaveBeenCalled();
    expect(ingestService.ingestFromPullItems).not.toHaveBeenCalled();
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

    const service = new ReviewsService(
      [google, tripadvisor, trustyou, consoleProvider],
      ingestService as any,
      db as any,
    );
    await service.pullReviews('prop-1', 'trustyou');
    expect(trustyou.pullReviews).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-1' }),
    );
    expect(consoleProvider.pullReviews).not.toHaveBeenCalled();
  });
});
