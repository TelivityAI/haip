#!/usr/bin/env bash
# One-command demo: Vonage Messages
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Vonage Messages (vonage-messages) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'vonage-messages'
echo "→ Messaging: set provider env and restart API (console fallback without keys)."

print_live_hint "VONAGE_API_KEY=..." "VONAGE_API_SECRET=..." "VONAGE_SMS_FROM=..."
echo
echo "Docs: docs/integrations/messaging-infobip-vonage-telegram.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Vonage Messages'"
echo "DONE."
