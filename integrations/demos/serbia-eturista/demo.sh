#!/usr/bin/env bash
# One-command demo: Serbia eTurista
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Serbia eTurista (serbia-eturista) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'serbia-eturista'
put_fiscal '{"guestRegistrationProviderKey":"serbia_eturista","guestRegistrationConfig":{"demo":true}}'
echo "Note: Console guest-registration provider — logs handoff."

print_live_hint
echo
echo "Docs: docs/integrations/serbia-fiscal.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Serbia eTurista'"
echo "DONE."
