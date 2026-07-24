#!/usr/bin/env bash
# One-command demo: TripAdvisor Content API
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: TripAdvisor Content API (tripadvisor-content-api) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'tripadvisor-content-api'
echo "→ Reviews: set vendor keys for live pull; console source used when unset."

print_live_hint "TRIPADVISOR_API_KEY=..." "TRIPADVISOR_LOCATION_ID=..."
echo
echo "Docs: docs/integrations/review-sources.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'TripAdvisor Content API'"
echo "DONE."
