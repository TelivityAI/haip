#!/usr/bin/env bash
# One-command demo: VIES (console adapter)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP adapter demo: VIES (vies) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Provider key: vies (console / demo handoff)"
require_api
enable_registry 'vies'
put_fiscal '{"fiscalProviderKey":"vies","documentType":"vies","fiscalConfig":{"demo":true}}'
echo "Note: Console adapter: logs handoff only. Live authority/partner client required for production filing."
print_live_hint
echo
echo "Go-live (not console):"
echo "  1. Obtain partner/authority credentials for this market."
echo "  2. Replace the console FiscalProvider/GuestRegistrationProvider with a real client."
echo "  3. Keep the same provider key (vies) in fiscal config."
echo "Docs: docs/integrations/wave3-fiscal-guest-reg.md"
echo "DONE."
