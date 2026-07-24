import { Injectable, Logger } from '@nestjs/common';
import type {
  ReviewPullRequest,
  ReviewPullResult,
  ReviewSourceProvider,
} from '../review-source.interface';

/**
 * Google Places / Business Profile review pull stub.
 *
 * Env: GOOGLE_PLACES_API_KEY. Caller supplies placeId (or GOOGLE_PLACES_PLACE_ID fallback).
 *
 * @see docs/integrations/review-sources.md — "Google Business Profile Reviews"
 */
@Injectable()
export class GoogleReviewsProvider implements ReviewSourceProvider {
  readonly name = 'google' as const;
  private readonly logger = new Logger(GoogleReviewsProvider.name);
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env['GOOGLE_PLACES_API_KEY'];
    if (!this.apiKey) {
      this.logger.log('Google Places API key not set — review pull will use console fallback');
    }
  }

  isConfigured(request: ReviewPullRequest): boolean {
    const placeId = request.placeId ?? process.env['GOOGLE_PLACES_PLACE_ID'];
    return Boolean(this.apiKey && placeId);
  }

  async pullReviews(request: ReviewPullRequest): Promise<ReviewPullResult> {
    const placeId = request.placeId ?? process.env['GOOGLE_PLACES_PLACE_ID'];
    if (!this.apiKey || !placeId) {
      return {
        pulled: false,
        provider: this.name,
        reviews: [],
        error: 'Google Places not configured (GOOGLE_PLACES_API_KEY + placeId)',
      };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'reviews');
    url.searchParams.set('key', this.apiKey);

    try {
      const res = await fetch(url);
      const data = (await res.json()) as {
        status?: string;
        result?: {
          reviews?: Array<{
            author_name?: string;
            rating?: number;
            text?: string;
            time?: number;
          }>;
        };
      };

      if (data.status !== 'OK' || !data.result?.reviews) {
        this.logger.warn(`Google Places review pull: status=${data.status ?? 'unknown'}`);
        return {
          pulled: false,
          provider: this.name,
          reviews: [],
          error: `Google Places API status: ${data.status ?? 'unknown'}`,
        };
      }

      const reviews = data.result.reviews.map((r, idx) => ({
        externalId: `google-${placeId}-${r.time ?? idx}`,
        guestName: r.author_name ?? 'Google reviewer',
        rating: Math.min(5, Math.max(1, Math.round(r.rating ?? 0))) || 1,
        reviewText: r.text ?? '',
        stayDate: r.time ? new Date(r.time * 1000).toISOString().slice(0, 10) : undefined,
        source: 'google' as const,
      }));

      this.logger.log(
        `[Reviews:google] property=${request.propertyId} pulled ${reviews.length} review(s)`,
      );
      return { pulled: true, provider: this.name, reviews };
    } catch (error: any) {
      this.logger.error(`Google review pull failed: ${error.message}`);
      return { pulled: false, provider: this.name, reviews: [], error: error.message };
    }
  }
}
