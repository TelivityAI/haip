#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: ReviewTrackers (reviewtrackers) ==="
require_api
enable_registry 'reviewtrackers'
echo "→ Reviews: POST /api/v1/reviews/pull with source=reviewtrackers (console until partner keys)."
print_live_hint "Partner API keys for ReviewTrackers"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
