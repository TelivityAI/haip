import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { propertyIntegrations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import type {
  ReviewPullRequest,
  ReviewPullResult,
  ReviewSourceName,
  ReviewSourceProvider,
} from './review-source.interface';
import { REVIEW_SOURCE_PROVIDERS } from './review-source.interface';
import { ReviewsIngestService } from './reviews-ingest.service';

export interface ScheduledIngestResult {
  propertyId: string;
  sources: Array<ReviewPullResult & { source: string }>;
  totalImported: number;
  totalUpdated: number;
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @Inject(REVIEW_SOURCE_PROVIDERS) private readonly providers: ReviewSourceProvider[],
    private readonly ingestService: ReviewsIngestService,
    @Inject(DRIZZLE) private readonly db: any,
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
    const pullResult = await provider.pullReviews(request);

    if (!pullResult.reviews.length) {
      return { ...pullResult, imported: 0, updated: 0, newReviewIds: [] };
    }

    const ingest = await this.ingestService.ingestFromPullItems(
      propertyId,
      pullResult.reviews,
      { placeId: opts?.placeId, locationId: opts?.locationId },
    );

    return {
      ...pullResult,
      imported: ingest.imported,
      updated: ingest.updated,
      newReviewIds: ingest.newReviewIds,
    };
  }

  /**
   * Hourly / scheduled ingest — pulls enabled review integrations for a property.
   * Called by external cron (see docs/operations/cron.md).
   */
  async ingestScheduled(propertyId: string): Promise<ScheduledIngestResult> {
    const sources: Array<ReviewPullResult & { source: string }> = [];
    let totalImported = 0;
    let totalUpdated = 0;

    const googleConfig = await this.getIntegrationConfig(propertyId, 'google-business-profile-reviews');
    const tripConfig = await this.getIntegrationConfig(propertyId, 'tripadvisor-content-api');

    const googlePlaceId =
      (googleConfig?.['placeId'] as string | undefined) ?? process.env['GOOGLE_PLACES_PLACE_ID'];
    if (googlePlaceId || process.env['GOOGLE_PLACES_API_KEY']) {
      try {
        const result = await this.pullReviews(propertyId, 'google', { placeId: googlePlaceId });
        sources.push({ ...result, source: 'google' });
        totalImported += result.imported ?? 0;
        totalUpdated += result.updated ?? 0;
      } catch (error: any) {
        this.logger.warn(`Scheduled google review pull failed: ${error?.message ?? error}`);
        sources.push({
          pulled: false,
          provider: 'google',
          reviews: [],
          error: error?.message ?? String(error),
          source: 'google',
        });
      }
    }

    const tripLocationId =
      (tripConfig?.['locationId'] as string | undefined) ?? process.env['TRIPADVISOR_LOCATION_ID'];
    if (tripLocationId || process.env['TRIPADVISOR_API_KEY']) {
      try {
        const result = await this.pullReviews(propertyId, 'tripadvisor', {
          locationId: tripLocationId,
        });
        sources.push({ ...result, source: 'tripadvisor' });
        totalImported += result.imported ?? 0;
        totalUpdated += result.updated ?? 0;
      } catch (error: any) {
        this.logger.warn(`Scheduled tripadvisor review pull failed: ${error?.message ?? error}`);
        sources.push({
          pulled: false,
          provider: 'tripadvisor',
          reviews: [],
          error: error?.message ?? String(error),
          source: 'tripadvisor',
        });
      }
    }

    return { propertyId, sources, totalImported, totalUpdated };
  }

  private async getIntegrationConfig(
    propertyId: string,
    catalogSlug: string,
  ): Promise<Record<string, unknown> | undefined> {
    const [row] = await this.db
      .select({ config: propertyIntegrations.config, enabled: propertyIntegrations.enabled })
      .from(propertyIntegrations)
      .where(
        and(
          eq(propertyIntegrations.propertyId, propertyId),
          eq(propertyIntegrations.catalogSlug, catalogSlug),
        ),
      );
    if (!row?.enabled) return undefined;
    return (row.config ?? {}) as Record<string, unknown>;
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
