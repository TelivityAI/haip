#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Facebook Page Ratings (facebook-page-ratings) ==="
require_api
enable_registry 'facebook-page-ratings'
echo "→ Reviews: POST /api/v1/reviews/pull with source=facebook-page-ratings (console until partner keys)."
print_live_hint "Partner API keys for Facebook Page Ratings"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
