#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Yotpo (yotpo) ==="
require_api
enable_registry 'yotpo'
echo "→ Reviews: POST /api/v1/reviews/pull with source=yotpo (console until partner keys)."
print_live_hint "Partner API keys for Yotpo"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
