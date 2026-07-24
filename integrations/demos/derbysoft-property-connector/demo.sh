#!/usr/bin/env bash
# One-command demo: DerbySoft Property Connector
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: DerbySoft Property Connector (derbysoft-property-connector) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Optional mock: docker compose --profile channels up -d mock-derbysoft"

require_api
enable_registry 'derbysoft-property-connector'
ensure_channel 'derbysoft' 'derbysoft'

print_live_hint "DERBYSOFT_HOTEL_ID=..." "DERBYSOFT_ACCOUNT_ID=..." "DERBYSOFT_CLIENT_SECRET=..."
echo
echo "Docs: docs/channels/derbysoft.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'DerbySoft Property Connector'"
echo "DONE."
