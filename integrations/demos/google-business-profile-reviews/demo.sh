#!/usr/bin/env bash
# One-command demo: Google Business Profile Reviews
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Google Business Profile Reviews (google-business-profile-reviews) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'google-business-profile-reviews'
echo "→ Reviews: set vendor keys for live pull; console source used when unset."

print_live_hint "GOOGLE_PLACES_API_KEY=..." "GOOGLE_PLACES_PLACE_ID=..."
echo
echo "Docs: docs/integrations/review-sources.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Google Business Profile Reviews'"
echo "DONE."
