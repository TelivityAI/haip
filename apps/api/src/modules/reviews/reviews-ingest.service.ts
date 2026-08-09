import { Injectable, Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { guestReviews } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import type { ExternalReviewItem, ReviewPullSourceName } from './review-source.interface';
import {
  mapChannexOtaToDbSource,
  normalizeReviewRating,
  type GuestReviewSource,
} from './review-ingest.util';

export type { GuestReviewSource } from './review-ingest.util';
export { mapChannexOtaToDbSource, normalizeReviewRating } from './review-ingest.util';

export interface ReviewIngestItem {
  externalId: string;
  guestName: string;
  rating: number;
  reviewText: string;
  stayDate?: string;
  source: GuestReviewSource;
  externalUrl?: string;
  providerPlaceId?: string;
  providerLocationId?: string;
  providerChannelId?: string;
}

export interface ReviewIngestResult {
  imported: number;
  updated: number;
  newReviewIds: string[];
}

/** Map pull-source names to guest_reviews.source enum values. */
export function mapPullSourceToDbSource(source: ReviewPullSourceName): GuestReviewSource {
  switch (source) {
    case 'google':
      return 'google';
    case 'tripadvisor':
      return 'tripadvisor';
    default:
      return 'other';
  }
}

@Injectable()
export class ReviewsIngestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  async ingestFromPullItems(
    propertyId: string,
    items: ExternalReviewItem[],
    providerMeta?: {
      placeId?: string;
      locationId?: string;
    },
  ): Promise<ReviewIngestResult> {
    const mapped: ReviewIngestItem[] = items.map((item) => ({
      externalId: item.externalId,
      guestName: item.guestName,
      rating: normalizeReviewRating(item.rating),
      reviewText: item.reviewText,
      stayDate: item.stayDate,
      source: mapPullSourceToDbSource(item.source),
      externalUrl: item.externalUrl,
      providerPlaceId: providerMeta?.placeId,
      providerLocationId: providerMeta?.locationId,
    }));
    return this.ingest(propertyId, mapped);
  }

  async ingest(propertyId: string, items: ReviewIngestItem[]): Promise<ReviewIngestResult> {
    const now = new Date();
    let imported = 0;
    let updated = 0;
    const newReviewIds: string[] = [];

    for (const item of items) {
      if (!item.externalId?.trim()) continue;

      const values = {
        propertyId,
        source: item.source,
        guestName: item.guestName,
        rating: normalizeReviewRating(item.rating),
        reviewText: item.reviewText,
        stayDate: item.stayDate ?? null,
        externalId: item.externalId,
        externalUrl: item.externalUrl ?? null,
        providerPlaceId: item.providerPlaceId ?? null,
        providerLocationId: item.providerLocationId ?? null,
        providerChannelId: item.providerChannelId ?? null,
        lastSyncedAt: now,
      };

      const [inserted] = await this.db
        .insert(guestReviews)
        .values(values)
        .onConflictDoNothing({
          target: [guestReviews.propertyId, guestReviews.source, guestReviews.externalId],
        })
        .returning({ id: guestReviews.id });

      if (inserted) {
        imported += 1;
        newReviewIds.push(inserted.id);
        await this.webhookService.emit(
          'guest.review.ingested',
          'guest_review',
          inserted.id,
          {
            reviewId: inserted.id,
            source: item.source,
            externalId: item.externalId,
          },
          propertyId,
        );
        continue;
      }

      await this.db
        .update(guestReviews)
        .set({
          guestName: values.guestName,
          rating: values.rating,
          reviewText: values.reviewText,
          stayDate: values.stayDate,
          externalUrl: values.externalUrl,
          providerPlaceId: values.providerPlaceId,
          providerLocationId: values.providerLocationId,
          providerChannelId: values.providerChannelId,
          lastSyncedAt: now,
        })
        .where(
          and(
            eq(guestReviews.propertyId, propertyId),
            eq(guestReviews.source, item.source),
            eq(guestReviews.externalId, item.externalId),
          ),
        );

      updated += 1;
    }

    return { imported, updated, newReviewIds };
  }
}
