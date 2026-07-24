import { Injectable, Logger } from '@nestjs/common';
import type {
  ReviewPullRequest,
  ReviewPullResult,
  ReviewSourceProvider,
} from '../review-source.interface';

@Injectable()
export class ConsoleReviewsProvider implements ReviewSourceProvider {
  readonly name = 'console' as const;
  private readonly logger = new Logger(ConsoleReviewsProvider.name);

  isConfigured(_request: ReviewPullRequest): boolean {
    return true;
  }

  async pullReviews(request: ReviewPullRequest): Promise<ReviewPullResult> {
    this.logger.log(
      `[Reviews:console] property=${request.propertyId} — no review source configured; pull logged only`,
    );
    return {
      pulled: false,
      provider: this.name,
      reviews: [],
      error: 'No review source configured — pull logged only',
    };
  }
}
