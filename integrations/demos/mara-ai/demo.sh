#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: MARA AI (mara-ai) ==="
require_api
enable_registry 'mara-ai'
echo "→ Reviews: POST /api/v1/reviews/pull with source=mara-ai (console until partner keys)."
print_live_hint "Partner API keys for MARA AI"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
