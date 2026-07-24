#!/usr/bin/env bash
# One-command demo: Luxembourg fiches d\ (console adapter)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP adapter demo: Luxembourg fiches d\ (luxembourg-fiches) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Provider key: luxembourg_fiches (console / demo handoff)"
require_api
enable_registry 'luxembourg-fiches'
put_fiscal '{"guestRegistrationProviderKey":"luxembourg_fiches","guestRegistrationConfig":{"demo":true}}'
echo "Note: Console adapter: logs handoff only. Live authority/partner client required for production filing."
print_live_hint
echo
echo "Go-live (not console):"
echo "  1. Obtain partner/authority credentials for this market."
echo "  2. Replace the console FiscalProvider/GuestRegistrationProvider with a real client."
echo "  3. Keep the same provider key (luxembourg_fiches) in fiscal config."
echo "Docs: docs/integrations/wave3-fiscal-guest-reg.md"
echo "DONE."
