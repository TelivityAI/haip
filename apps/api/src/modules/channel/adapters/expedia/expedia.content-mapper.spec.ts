import { describe, it, expect } from 'vitest';
import {
  validateImagesForExpedia,
  mapMediaToExpediaImages,
  EXPEDIA_IMAGE_LIMITS,
} from './expedia.content-mapper';
import type { ContentMediaItem } from '../../channel-adapter.interface';

function img(over: Partial<ContentMediaItem> = {}): ContentMediaItem {
  return {
    url: 'https://x/photo.jpg',
    category: 'room',
    caption: null,
    isPrimary: false,
    sortOrder: 0,
    contentType: null,
    width: null,
    height: null,
    fileSize: null,
    ...over,
  };
}

describe('validateImagesForExpedia', () => {
  it('accepts http(s)-hosted jpeg/png', () => {
    const { accepted, rejected } = validateImagesForExpedia([img(), img({ url: 'https://x/a.png' })]);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it('rejects non-http(s) hosted images', () => {
    const { rejected } = validateImagesForExpedia([img({ url: 'ftp://x/a.jpg' })]);
    expect(rejected[0]!.reason).toMatch(/HTTP\(S\)\/AWS/);
  });

  it('rejects images below 650x650 and over 15 MB', () => {
    const { accepted, rejected } = validateImagesForExpedia([
      img({ width: 640, height: 480 }),
      img({ fileSize: EXPEDIA_IMAGE_LIMITS.maxBytes + 1 }),
    ]);
    expect(accepted).toHaveLength(0);
    expect(rejected.map((r) => r.reason).join()).toMatch(/650|bytes/);
  });
});

describe('mapMediaToExpediaImages', () => {
  it('builds the Image API body with url + category', () => {
    const body = mapMediaToExpediaImages([img({ caption: 'Cozy' })]);
    expect(body.images[0]).toEqual({ url: 'https://x/photo.jpg', caption: 'Cozy', category: 'room' });
  });
});
