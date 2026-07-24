#!/usr/bin/env bash
# One-command demo: Channex
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Channex (channex) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'channex'
ensure_channel 'channex' 'channex'

print_live_hint "CHANNEX_API_KEY=..." "CHANNEX_PROPERTY_ID=..."
echo
echo "Docs: docs/integrations/channel-beds24-channex.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Channex'"
echo "DONE."
