import type { ContentMediaItem, ContentPushParams } from '../../channel-adapter.interface';

/**
 * Expedia Image API mapping (JSON REST).
 *
 * VERIFIED limits (developers.expediagroup.com/supply/lodging/docs/
 * property_mgmt_apis/image/getting_started/requirements-best-practices):
 *  - reject images below 650×650 px; recommend ≥ 2,880 px on the longest edge.
 *  - max file size 15 MB.
 *  - images MUST be hosted on HTTP/HTTPS or AWS (no FTP/SFTP).
 *  - guidance: ≥ 3 images/property (≥ 20 suggested); ≥ 4 per room type + 1 bathroom.
 * Endpoint: POST /properties/{propertyId}/images (by URL).
 */
export const EXPEDIA_IMAGE_LIMITS = {
  minDimension: 650,
  recommendedLongEdge: 2880,
  maxBytes: 15_000_000,
  allowedContentTypes: ['image/jpeg', 'image/png'],
  allowedExtensions: ['.jpg', '.jpeg', '.png'],
  minPerProperty: 3,
} as const;

export interface ExpediaImageValidation {
  accepted: ContentMediaItem[];
  rejected: Array<{ url: string; reason: string }>;
}

export function validateImagesForExpedia(images: ContentMediaItem[]): ExpediaImageValidation {
  const accepted: ContentMediaItem[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];
  for (const img of images) {
    if (!/^https?:\/\//i.test(img.url)) {
      rejected.push({ url: img.url, reason: 'images must be HTTP(S)/AWS-hosted' });
      continue;
    }
    if (!isAllowedFormat(img)) {
      rejected.push({ url: img.url, reason: 'unsupported format (jpeg/png)' });
      continue;
    }
    if (img.fileSize != null && img.fileSize > EXPEDIA_IMAGE_LIMITS.maxBytes) {
      rejected.push({ url: img.url, reason: `exceeds ${EXPEDIA_IMAGE_LIMITS.maxBytes} bytes` });
      continue;
    }
    if (
      (img.width != null && img.width < EXPEDIA_IMAGE_LIMITS.minDimension) ||
      (img.height != null && img.height < EXPEDIA_IMAGE_LIMITS.minDimension)
    ) {
      rejected.push({ url: img.url, reason: `below ${EXPEDIA_IMAGE_LIMITS.minDimension}×${EXPEDIA_IMAGE_LIMITS.minDimension}px` });
      continue;
    }
    accepted.push(img);
  }
  return { accepted, rejected };
}

function isAllowedFormat(img: ContentMediaItem): boolean {
  if (img.contentType) {
    return (EXPEDIA_IMAGE_LIMITS.allowedContentTypes as readonly string[]).includes(img.contentType.toLowerCase());
  }
  const url = img.url.toLowerCase().split('?')[0] ?? '';
  return EXPEDIA_IMAGE_LIMITS.allowedExtensions.some((ext) => url.endsWith(ext));
}

export interface ExpediaImagesBody {
  images: Array<{ url: string; caption?: string; category?: string }>;
}

/** Image API request body (VERIFY exact field names against the Image API spec). */
export function mapMediaToExpediaImages(images: ContentMediaItem[]): ExpediaImagesBody {
  return {
    images: images.map((m) => ({
      url: m.url,
      ...(m.caption ? { caption: m.caption } : {}),
      category: m.category,
    })),
  };
}

/** Property API body for room/property descriptions (VERIFY). */
export function mapPropertyForExpedia(property: ContentPushParams['property']) {
  return {
    // VERIFY: Property Management API request schema.
    name: property.name,
    description: property.description ?? undefined,
    starRating: property.starRating ?? undefined,
  };
}
