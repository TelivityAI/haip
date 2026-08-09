export type GuestReviewSource =
  | 'google'
  | 'tripadvisor'
  | 'booking_com'
  | 'expedia'
  | 'other';

/** Map Channex OTA label to guest_reviews.source enum. */
export function mapChannexOtaToDbSource(ota: string | undefined): GuestReviewSource {
  const key = (ota ?? '').toLowerCase();
  if (key.includes('booking')) return 'booking_com';
  if (key.includes('expedia')) return 'expedia';
  if (key.includes('tripadvisor')) return 'tripadvisor';
  if (key.includes('google')) return 'google';
  return 'other';
}

/** Normalize OTA / partner scores (often 10-point) to 1–5 stars. */
export function normalizeReviewRating(score: number): number {
  if (!Number.isFinite(score)) return 3;
  if (score > 5) {
    return Math.min(5, Math.max(1, Math.round(score / 2)));
  }
  return Math.min(5, Math.max(1, Math.round(score)));
}
