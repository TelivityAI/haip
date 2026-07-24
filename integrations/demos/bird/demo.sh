#!/usr/bin/env bash
# One-command demo: Bird SMS
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Bird SMS (bird) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'bird'
echo "→ Messaging: set provider env and restart API (console fallback without keys)."

print_live_hint "BIRD_ACCESS_KEY=..." "BIRD_ORIGINATOR=..."
echo
echo "Docs: docs/integrations/bird-sms.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Bird SMS'"
echo "DONE."
