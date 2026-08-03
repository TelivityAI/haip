#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: TrustYou (trustyou) ==="
require_api
enable_registry 'trustyou'
echo "→ Reviews: POST /api/v1/reviews/pull with source=trustyou (console until partner keys)."
print_live_hint "Partner API keys for TrustYou"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
