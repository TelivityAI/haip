import {
  mapChannexOtaToDbSource,
  normalizeReviewRating,
} from '../../../reviews/review-ingest.util';
import type { ReviewIngestItem } from '../../../reviews/reviews-ingest.service';

export interface ChannexReviewPayload {
  id?: string;
  content?: string | null;
  raw_content?: string | null;
  channel_id?: string;
  ota?: string;
  property_id?: string;
  overall_score?: number;
  ota_overall_score?: number;
  ota_review_id?: string;
  reviewer_name?: string | null;
  received_at?: string;
  booking_id?: string;
}

function extractReviewText(payload: ChannexReviewPayload): string {
  const candidates = [payload.content, payload.raw_content];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'Guest review received via Channex (no public text).';
}

function extractGuestName(payload: ChannexReviewPayload): string {
  if (payload.reviewer_name?.trim()) return payload.reviewer_name.trim();
  return 'OTA Guest';
}

function extractStayDate(payload: ChannexReviewPayload): string | undefined {
  if (!payload.received_at) return undefined;
  const d = new Date(payload.received_at);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/**
 * Map a Channex `review` webhook payload to a guest_reviews ingest row.
 */
export function mapChannexReviewToIngest(
  payload: ChannexReviewPayload | Record<string, unknown>,
): ReviewIngestItem | null {
  const row = payload as ChannexReviewPayload;
  const channexId = typeof row.id === 'string' ? row.id.trim() : '';
  if (!channexId) return null;

  const otaReviewId = typeof row.ota_review_id === 'string' ? row.ota_review_id.trim() : '';
  const externalId = otaReviewId ? `channex-ota-${otaReviewId}` : `channex-${channexId}`;

  const score = row.overall_score ?? row.ota_overall_score ?? 0;

  return {
    externalId,
    guestName: extractGuestName(row),
    rating: normalizeReviewRating(score),
    reviewText: extractReviewText(row),
    stayDate: extractStayDate(row),
    source: mapChannexOtaToDbSource(row.ota),
    providerChannelId: row.channel_id,
  };
}
