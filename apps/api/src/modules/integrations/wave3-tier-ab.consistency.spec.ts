import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wave 3 Tier A/B — 50 catalog rows must stay honest:
 * registry status matches slice maturity, and each slug has a demo folder.
 */
const WAVE3_TIER_AB: ReadonlyArray<{ slug: string; status: 'shipped' | 'adapter' | 'recipe' }> = [
  { slug: 'whatsapp-cloud-api', status: 'shipped' },
  { slug: 'mailgun', status: 'shipped' },
  { slug: 'amazon-ses', status: 'shipped' },
  { slug: 'expedia-eqc', status: 'adapter' },
  { slug: 'myallocator-cloudbeds', status: 'adapter' },
  { slug: 'atomize', status: 'adapter' },
  { slug: 'yieldplanet', status: 'adapter' },
  { slug: 'd-edge', status: 'adapter' },
  { slug: 'cubilis-lighthouse', status: 'adapter' },
  { slug: 'rategain', status: 'adapter' },
  { slug: 'hotelrunner', status: 'adapter' },
  { slug: 'nextpax', status: 'adapter' },
  { slug: 'hotelbeds-api-suite', status: 'adapter' },
  { slug: 'amadeus-self-service-hotel-apis', status: 'adapter' },
  { slug: 'wise-platform', status: 'adapter' },
  { slug: 'trustyou', status: 'adapter' },
  { slug: 'customer-alliance', status: 'adapter' },
  { slug: 'trustpilot', status: 'adapter' },
  { slug: 'yotpo', status: 'adapter' },
  { slug: 'mara-ai', status: 'adapter' },
  { slug: 'guest-suite', status: 'adapter' },
  { slug: 'facebook-page-ratings', status: 'adapter' },
  { slug: 'reviewtrackers', status: 'adapter' },
  { slug: 'foursquare-places', status: 'adapter' },
  { slug: 'apache-superset', status: 'recipe' },
  { slug: 'looker-studio', status: 'recipe' },
  { slug: 'grafana', status: 'recipe' },
  { slug: 'quickbooks-online', status: 'recipe' },
  { slug: 'xero', status: 'recipe' },
  { slug: 'sage-business-cloud', status: 'recipe' },
  { slug: 'zoho-books', status: 'recipe' },
  { slug: 'datev', status: 'recipe' },
  { slug: 'bexio', status: 'recipe' },
  { slug: 'exact-online', status: 'recipe' },
  { slug: 'square-pos', status: 'recipe' },
  { slug: 'toast', status: 'recipe' },
  { slug: 'clover', status: 'recipe' },
  { slug: 'epos-now', status: 'recipe' },
  { slug: 'shopify-pos', status: 'recipe' },
  { slug: 'loyverse', status: 'recipe' },
  { slug: 'erply', status: 'recipe' },
  { slug: 'marketman', status: 'recipe' },
  { slug: 'mailchimp', status: 'recipe' },
  { slug: 'hubspot-free-crm', status: 'recipe' },
  { slug: 'brevo', status: 'recipe' },
  { slug: 'activecampaign', status: 'recipe' },
  { slug: 'zendesk', status: 'recipe' },
  { slug: 'cendyn', status: 'recipe' },
  { slug: 'keap', status: 'recipe' },
  { slug: 'frankfurter-ecb-fx', status: 'recipe' },
];

function repoRoot(): string {
  // apps/api/src/modules/integrations → repo root
  return join(__dirname, '../../../../../');
}

describe('Wave 3 Tier A/B consistency', () => {
  it('tracks exactly 50 integrations', () => {
    expect(WAVE3_TIER_AB).toHaveLength(50);
  });

  it('registry seed status matches each slug', () => {
    const seed = readFileSync(
      join(repoRoot(), 'packages/database/src/schema/integration-registry-seed.ts'),
      'utf8',
    );
    for (const { slug, status } of WAVE3_TIER_AB) {
      const re = new RegExp(
        `slug: '${slug}',\\s*category: '[^']+',\\s*name: '[^']*',\\s*status: '([^']+)'`,
      );
      const m = seed.match(re);
      expect(m, `missing seed row for ${slug}`).toBeTruthy();
      expect(m![1], slug).toBe(status);
    }
  });

  it('manifest + demo.sh exist for each slug', () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot(), 'integrations/demos/manifest.json'), 'utf8'),
    ) as { demos: Array<{ slug: string; maturity: string }> };
    const bySlug = new Map(manifest.demos.map((d) => [d.slug, d]));
    for (const { slug, status } of WAVE3_TIER_AB) {
      const entry = bySlug.get(slug);
      expect(entry, `missing manifest entry for ${slug}`).toBeTruthy();
      expect(entry!.maturity, slug).toBe(status);
      const demoSh = join(repoRoot(), 'integrations/demos', slug, 'demo.sh');
      expect(readFileSync(demoSh, 'utf8').length).toBeGreaterThan(0);
    }
  });
});
