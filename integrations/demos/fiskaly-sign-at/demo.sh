#!/usr/bin/env bash
# One-command demo: fiskaly SIGN AT (console adapter)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP adapter demo: fiskaly SIGN AT (fiskaly-sign-at) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Provider key: fiskaly_sign_at (console / demo handoff)"
require_api
enable_registry 'fiskaly-sign-at'
put_fiscal '{"fiscalProviderKey":"fiskaly_sign_at","documentType":"fiskaly_sign_at","fiscalConfig":{"demo":true}}'
echo "Note: Console adapter: logs handoff only. Live authority/partner client required for production filing."
print_live_hint
echo
echo "Go-live (not console):"
echo "  1. Obtain partner/authority credentials for this market."
echo "  2. Replace the console FiscalProvider/GuestRegistrationProvider with a real client."
echo "  3. Keep the same provider key (fiskaly_sign_at) in fiscal config."
echo "Docs: docs/integrations/fiskaly-sign-at.md"
echo "DONE."
