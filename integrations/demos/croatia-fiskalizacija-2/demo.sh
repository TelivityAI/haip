#!/usr/bin/env bash
# One-command demo: Croatia Fiskalizacija 2.0 (console adapter)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP adapter demo: Croatia Fiskalizacija 2.0 (croatia-fiskalizacija-2) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
echo "Provider key: croatia_fiskalizacija_2 (console / demo handoff)"
require_api
enable_registry 'croatia-fiskalizacija-2'
put_fiscal '{"fiscalProviderKey":"croatia_fiskalizacija_2","documentType":"croatia_fiskalizacija_2","fiscalConfig":{"demo":true}}'
echo "Note: Console adapter: logs handoff only. Live authority/partner client required for production filing."
print_live_hint
echo
echo "Go-live (not console):"
echo "  1. Obtain partner/authority credentials for this market."
echo "  2. Replace the console FiscalProvider/GuestRegistrationProvider with a real client."
echo "  3. Keep the same provider key (croatia_fiskalizacija_2) in fiscal config."
echo "Docs: docs/integrations/wave3-fiscal-guest-reg.md"
echo "DONE."
