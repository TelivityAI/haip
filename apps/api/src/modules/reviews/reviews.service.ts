import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  ReviewPullRequest,
  ReviewPullResult,
  ReviewSourceName,
  ReviewSourceProvider,
} from './review-source.interface';
import { REVIEW_SOURCE_PROVIDERS } from './review-source.interface';

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(REVIEW_SOURCE_PROVIDERS) private readonly providers: ReviewSourceProvider[],
  ) {}

  async pullReviews(
    propertyId: string,
    source: ReviewSourceName,
    opts?: { placeId?: string; locationId?: string },
  ): Promise<ReviewPullResult> {
    if (source === 'console') {
      throw new BadRequestException(
        'Specify a review source (google, tripadvisor, or a Wave 3 reputation pack)',
      );
    }

    const request: ReviewPullRequest = {
      propertyId,
      placeId: opts?.placeId,
      locationId: opts?.locationId,
    };

    const provider = this.resolveProvider(source, request);
    return provider.pullReviews(request);
  }

  private resolveProvider(
    source: ReviewSourceName,
    request: ReviewPullRequest,
  ): ReviewSourceProvider {
    const named = this.providers.find((p) => p.name === source);
    if (named?.isConfigured(request)) {
      return named;
    }
    const fallback = this.providers.find((p) => p.name === 'console');
    if (!fallback) {
      throw new Error('No review source provider registered');
    }
    return fallback;
  }
}
