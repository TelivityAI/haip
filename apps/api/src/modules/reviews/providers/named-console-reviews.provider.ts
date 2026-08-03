import { Injectable, Logger } from '@nestjs/common';
import type {
  ReviewPullRequest,
  ReviewPullResult,
  ReviewSourceName,
  ReviewSourceProvider,
} from '../review-source.interface';

/**
 * Named console review packs (Wave 3). Logs pull attempts; no vendor HTTP until
 * partner credentials and a real client replace the console implementation.
 */
@Injectable()
export class NamedConsoleReviewsProvider implements ReviewSourceProvider {
  private readonly logger: Logger;
  readonly name: ReviewSourceName;

  constructor(
    key: ReviewSourceName,
    readonly label: string,
  ) {
    this.name = key;
    this.logger = new Logger(`ReviewsConsole:${key}`);
  }

  isConfigured(_request: ReviewPullRequest): boolean {
    return true;
  }

  async pullReviews(request: ReviewPullRequest): Promise<ReviewPullResult> {
    this.logger.log(
      `[Reviews:${this.name}] property=${request.propertyId} — ${this.label} console handoff; pull logged only`,
    );
    return {
      pulled: false,
      provider: this.name,
      reviews: [],
      error: `${this.label} console adapter — no vendor HTTP until partner credentials`,
    };
  }
}

/** Catalog slug ↔ review source name for Wave 3 reputation consoles. */
export const WAVE_REVIEW_CONSOLE_PACKS: ReadonlyArray<{
  key: Exclude<ReviewSourceName, 'google' | 'tripadvisor' | 'console'>;
  label: string;
}> = [
  { key: 'trustyou', label: 'TrustYou' },
  { key: 'customer-alliance', label: 'Customer Alliance' },
  { key: 'trustpilot', label: 'Trustpilot' },
  { key: 'yotpo', label: 'Yotpo' },
  { key: 'mara-ai', label: 'MARA AI' },
  { key: 'guest-suite', label: 'Guest Suite' },
  { key: 'facebook-page-ratings', label: 'Facebook Page Ratings' },
  { key: 'reviewtrackers', label: 'ReviewTrackers' },
  { key: 'foursquare-places', label: 'Foursquare Places' },
];
