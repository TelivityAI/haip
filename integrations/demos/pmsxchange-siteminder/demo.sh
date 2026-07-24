#!/usr/bin/env bash
# One-command demo: pmsXchange (SiteMinder)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: pmsXchange (SiteMinder) (pmsxchange-siteminder) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Optional mock: docker compose --profile channels up -d mock-siteminder"

require_api
enable_registry 'pmsxchange-siteminder'
ensure_channel 'siteminder' 'siteminder'

print_live_hint "SITEMINDER_HOTEL_CODE=..." "SITEMINDER_USERNAME=..." "SITEMINDER_PASSWORD=..."
echo
echo "Docs: docs/INTEGRATIONS.md#channel-managers"
echo "Dashboard: $HAIP_URL → Integrations → enable 'pmsXchange (SiteMinder)'"
echo "DONE."
