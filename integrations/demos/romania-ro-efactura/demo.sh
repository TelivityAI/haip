#!/usr/bin/env bash
# One-command demo: Romania RO e-Factura (console adapter)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP adapter demo: Romania RO e-Factura (romania-ro-efactura) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Provider key: romania_ro_efactura (console / demo handoff)"
require_api
enable_registry 'romania-ro-efactura'
put_fiscal '{"fiscalProviderKey":"romania_ro_efactura","documentType":"romania_ro_efactura","fiscalConfig":{"demo":true}}'
echo "Note: Console adapter: logs handoff only. Live authority/partner client required for production filing."
print_live_hint
echo
echo "Go-live (not console):"
echo "  1. Obtain partner/authority credentials for this market."
echo "  2. Replace the console FiscalProvider/GuestRegistrationProvider with a real client."
echo "  3. Keep the same provider key (romania_ro_efactura) in fiscal config."
echo "Docs: docs/integrations/wave3-fiscal-guest-reg.md"
echo "DONE."
