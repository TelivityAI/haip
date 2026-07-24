/**
 * External review source pull abstraction (Google Business Profile / TripAdvisor Content API).
 */
export type ReviewSourceName = 'google' | 'tripadvisor' | 'console';

export interface ExternalReviewItem {
  externalId: string;
  guestName: string;
  rating: number;
  reviewText: string;
  stayDate?: string;
  source: 'google' | 'tripadvisor';
}

export interface ReviewPullResult {
  pulled: boolean;
  provider: string;
  reviews: ExternalReviewItem[];
  error?: string;
}

export interface ReviewPullRequest {
  propertyId: string;
  /** Google Places place_id or Business Profile location id */
  placeId?: string;
  /** TripAdvisor location id for Content API */
  locationId?: string;
}

export interface ReviewSourceProvider {
  readonly name: ReviewSourceName;
  isConfigured(request: ReviewPullRequest): boolean;
  pullReviews(request: ReviewPullRequest): Promise<ReviewPullResult>;
}

export const REVIEW_SOURCE_PROVIDERS = Symbol('REVIEW_SOURCE_PROVIDERS');
