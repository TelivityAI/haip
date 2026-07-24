import { Injectable, Logger } from '@nestjs/common';
import type {
  ReviewPullRequest,
  ReviewPullResult,
  ReviewSourceProvider,
} from '../review-source.interface';

/**
 * TripAdvisor Content API review pull stub.
 *
 * Env: TRIPADVISOR_API_KEY. Caller supplies locationId (or TRIPADVISOR_LOCATION_ID).
 * Partner Content API access is required for live data; without credentials this provider
 * stays unconfigured and the console fallback logs the pull attempt.
 *
 * @see docs/integrations/review-sources.md — "TripAdvisor Content API"
 */
@Injectable()
export class TripadvisorReviewsProvider implements ReviewSourceProvider {
  readonly name = 'tripadvisor' as const;
  private readonly logger = new Logger(TripadvisorReviewsProvider.name);
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env['TRIPADVISOR_API_KEY'];
    if (!this.apiKey) {
      this.logger.log('TripAdvisor API key not set — review pull will use console fallback');
    }
  }

  isConfigured(request: ReviewPullRequest): boolean {
    const locationId = request.locationId ?? process.env['TRIPADVISOR_LOCATION_ID'];
    return Boolean(this.apiKey && locationId);
  }

  async pullReviews(request: ReviewPullRequest): Promise<ReviewPullResult> {
    const locationId = request.locationId ?? process.env['TRIPADVISOR_LOCATION_ID'];
    if (!this.apiKey || !locationId) {
      return {
        pulled: false,
        provider: this.name,
        reviews: [],
        error: 'TripAdvisor not configured (TRIPADVISOR_API_KEY + locationId)',
      };
    }

    const url = `https://api.content.tripadvisor.com/api/v1/location/${locationId}/reviews?key=${this.apiKey}&language=en`;

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`TripAdvisor review pull HTTP ${res.status}: ${body.slice(0, 200)}`);
        return {
          pulled: false,
          provider: this.name,
          reviews: [],
          error: `TripAdvisor HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        data?: Array<{
          id?: string;
          rating?: number;
          text?: string;
          user?: { username?: string };
          published_date?: string;
        }>;
      };

      const items = data.data ?? [];
      const reviews = items.map((r) => ({
        externalId: `tripadvisor-${r.id ?? locationId}`,
        guestName: r.user?.username ?? 'TripAdvisor reviewer',
        rating: Math.min(5, Math.max(1, Math.round(r.rating ?? 0))) || 1,
        reviewText: r.text ?? '',
        stayDate: r.published_date?.slice(0, 10),
        source: 'tripadvisor' as const,
      }));

      this.logger.log(
        `[Reviews:tripadvisor] property=${request.propertyId} pulled ${reviews.length} review(s)`,
      );
      return { pulled: true, provider: this.name, reviews };
    } catch (error: any) {
      this.logger.error(`TripAdvisor review pull failed: ${error.message}`);
      return { pulled: false, provider: this.name, reviews: [], error: error.message };
    }
  }
}
