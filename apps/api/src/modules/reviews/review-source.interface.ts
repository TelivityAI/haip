/**
 * External review source pull abstraction (Google / TripAdvisor / Wave 3 console packs).
 */
export type ReviewSourceName =
  | 'google'
  | 'tripadvisor'
  | 'trustyou'
  | 'customer-alliance'
  | 'trustpilot'
  | 'yotpo'
  | 'mara-ai'
  | 'guest-suite'
  | 'facebook-page-ratings'
  | 'reviewtrackers'
  | 'foursquare-places'
  | 'console';

/** Sources accepted on POST /reviews/pull (excludes internal console fallback). */
export type ReviewPullSourceName = Exclude<ReviewSourceName, 'console'>;

export const REVIEW_PULL_SOURCE_NAMES: readonly ReviewPullSourceName[] = [
  'google',
  'tripadvisor',
  'trustyou',
  'customer-alliance',
  'trustpilot',
  'yotpo',
  'mara-ai',
  'guest-suite',
  'facebook-page-ratings',
  'reviewtrackers',
  'foursquare-places',
] as const;

export interface ExternalReviewItem {
  externalId: string;
  guestName: string;
  rating: number;
  reviewText: string;
  stayDate?: string;
  source: ReviewPullSourceName;
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
  /** TripAdvisor / partner location id for Content API */
  locationId?: string;
}

export interface ReviewSourceProvider {
  readonly name: ReviewSourceName;
  isConfigured(request: ReviewPullRequest): boolean;
  pullReviews(request: ReviewPullRequest): Promise<ReviewPullResult>;
}

export const REVIEW_SOURCE_PROVIDERS = Symbol('REVIEW_SOURCE_PROVIDERS');
