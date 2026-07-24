#!/usr/bin/env bash
# One-command demo: Portugal SIBA (console adapter)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP adapter demo: Portugal SIBA (portugal-siba) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Provider key: portugal_siba (console / demo handoff)"
require_api
enable_registry 'portugal-siba'
put_fiscal '{"guestRegistrationProviderKey":"portugal_siba","guestRegistrationConfig":{"demo":true}}'
echo "Note: Console adapter: logs handoff only. Live authority/partner client required for production filing."
print_live_hint
echo
echo "Go-live (not console):"
echo "  1. Obtain partner/authority credentials for this market."
echo "  2. Replace the console FiscalProvider/GuestRegistrationProvider with a real client."
echo "  3. Keep the same provider key (portugal_siba) in fiscal config."
echo "Docs: docs/integrations/wave3-fiscal-guest-reg.md"
echo "DONE."
