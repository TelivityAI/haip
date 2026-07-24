#!/usr/bin/env bash
# One-command demo: Beds24
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Beds24 (beds24) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'beds24'
ensure_channel 'beds24' 'beds24'
echo "Note: Missing credentials → console channel stub (logged, no HTTP)."

print_live_hint "BEDS24_API_KEY=..." "BEDS24_PROP_KEY=..."
echo
echo "Docs: docs/integrations/channel-beds24-channex.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Beds24'"
echo "DONE."
