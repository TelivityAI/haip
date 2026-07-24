#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Customer Alliance (customer-alliance) ==="
require_api
enable_registry 'customer-alliance'
echo "→ Reviews: POST /api/v1/reviews/pull with source=customer-alliance (console until partner keys)."
print_live_hint "Partner API keys for Customer Alliance"
echo "Docs: docs/integrations/wave3-reviews.md"
echo "DONE."
