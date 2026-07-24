#!/usr/bin/env bash
# One-command demo: Nuki
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Nuki (nuki) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'nuki'
echo "→ Lock demos: set DOOR_LOCK_PROVIDER=nuki and restart API (console fallback without keys)."
echo "Note: Without credentials the lock factory falls back to console."

print_live_hint "NUKI_API_TOKEN=..." "NUKI_SMARTLOCK_ID=..."
echo
echo "Docs: docs/integrations/door-locks-nuki-ttlock-salto.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Nuki'"
echo "DONE."
