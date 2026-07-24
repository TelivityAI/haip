#!/usr/bin/env bash
# One-command demo: TTLock
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: TTLock (ttlock) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'ttlock'
echo "→ Lock demos: set DOOR_LOCK_PROVIDER=ttlock and restart API (console fallback without keys)."

print_live_hint "TTLOCK_CLIENT_ID=..." "TTLOCK_CLIENT_SECRET=..." "TTLOCK_USERNAME=..." "TTLOCK_PASSWORD=..." "TTLOCK_LOCK_ID=..."
echo
echo "Docs: docs/integrations/door-locks-nuki-ttlock-salto.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'TTLock'"
echo "DONE."
