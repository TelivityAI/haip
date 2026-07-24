#!/usr/bin/env bash
# One-command demo: Salto KS
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Salto KS (salto-ks) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'salto-ks'
echo "→ Lock demos: set DOOR_LOCK_PROVIDER=salto_ks and restart API (console fallback without keys)."

print_live_hint "SALTO_KS_CLIENT_ID=..." "SALTO_KS_CLIENT_SECRET=..." "SALTO_KS_SITE_ID=..."
echo
echo "Docs: docs/integrations/door-locks-nuki-ttlock-salto.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Salto KS'"
echo "DONE."
