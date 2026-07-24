#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Guest Suite (guest-suite) ==="
require_api
enable_registry 'guest-suite'
echo "→ Reviews: POST /api/v1/reviews/pull with source=guest-suite (console until partner keys)."
print_live_hint "Partner API keys for Guest Suite"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
