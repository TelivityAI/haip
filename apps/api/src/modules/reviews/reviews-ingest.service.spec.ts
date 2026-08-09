import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewsIngestService } from './reviews-ingest.service';
import { mapPullSourceToDbSource } from './reviews-ingest.service';
import { mapChannexOtaToDbSource, normalizeReviewRating } from './review-ingest.util';

describe('reviews ingest helpers', () => {
  it('maps pull sources to db enum', () => {
    expect(mapPullSourceToDbSource('google')).toBe('google');
    expect(mapPullSourceToDbSource('tripadvisor')).toBe('tripadvisor');
    expect(mapPullSourceToDbSource('trustyou')).toBe('other');
  });

  it('maps Channex OTA labels', () => {
    expect(mapChannexOtaToDbSource('BookingCom')).toBe('booking_com');
    expect(mapChannexOtaToDbSource('Expedia')).toBe('expedia');
  });

  it('normalizes 10-point scores to 1–5', () => {
    expect(normalizeReviewRating(10)).toBe(5);
    expect(normalizeReviewRating(7.5)).toBe(4);
    expect(normalizeReviewRating(3)).toBe(3);
  });
});

describe('ReviewsIngestService', () => {
  const webhookService = { emit: vi.fn() };
  let db: any;
  let service: ReviewsIngestService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      insert: vi.fn(),
      update: vi.fn(),
    };
    service = new ReviewsIngestService(db, webhookService as any);
  });

  it('inserts new reviews and emits ingest event', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'review-1' }]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    db.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing }) });

    const result = await service.ingest('prop-1', [
      {
        externalId: 'google-abc',
        guestName: 'Jane',
        rating: 5,
        reviewText: 'Great stay',
        source: 'google',
      },
    ]);

    expect(result.imported).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.newReviewIds).toEqual(['review-1']);
    expect(webhookService.emit).toHaveBeenCalledWith(
      'guest.review.ingested',
      'guest_review',
      'review-1',
      expect.objectContaining({ reviewId: 'review-1' }),
      'prop-1',
    );
  });

  it('updates existing reviews without emitting ingest event', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    db.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing }) });
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });

    const result = await service.ingest('prop-1', [
      {
        externalId: 'google-abc',
        guestName: 'Jane',
        rating: 4,
        reviewText: 'Updated text',
        source: 'google',
      },
    ]);

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
    expect(webhookService.emit).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });
});
