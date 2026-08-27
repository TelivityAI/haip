export type HaipMetadataClassification = 'external' | 'owned-valid' | 'owned-malformed';

export function hasHaipFinancialMetadata(
  metadata: Record<string, string> | null | undefined,
): boolean {
  return Object.keys(metadata ?? {}).some((key) => key.startsWith('haip_'));
}

/**
 * Classifies PaymentIntent metadata for intents that remain unmatched after the
 * legacy-compatible gateway transaction lookup. Separates Stripe-account noise
 * from HAIP-owned traffic; event-specific correlation parsers remain responsible
 * for exact required fields.
 */
export function classifyHaipMetadata(
  metadata: Record<string, string> | null | undefined,
): HaipMetadataClassification {
  if (!hasHaipFinancialMetadata(metadata)) return 'external';
  return Object.entries(metadata ?? {}).some(([key, value]) => key.startsWith('haip_') && !value)
    ? 'owned-malformed'
    : 'owned-valid';
}
