#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Foursquare Places (foursquare-places) ==="
require_api
enable_registry 'foursquare-places'
echo "→ Reviews: POST /api/v1/reviews/pull with source=foursquare-places (console until partner keys)."
print_live_hint "Partner API keys for Foursquare Places"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
