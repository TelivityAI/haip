#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Trustpilot (trustpilot) ==="
require_api
enable_registry 'trustpilot'
echo "→ Reviews: POST /api/v1/reviews/pull with source=trustpilot (console until partner keys)."
print_live_hint "Partner API keys for Trustpilot"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
