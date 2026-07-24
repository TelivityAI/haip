#!/usr/bin/env bash
# One-command demo: Infobip Omnichannel
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Infobip Omnichannel (infobip-omnichannel) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'infobip-omnichannel'
echo "→ Messaging: set provider env and restart API (console fallback without keys)."
echo "Note: Without Infobip credentials SMS falls through to console."

print_live_hint "INFOBIP_API_KEY=..." "INFOBIP_SMS_FROM=..." "INFOBIP_BASE_URL=https://....api.infobip.com"
echo
echo "Docs: docs/integrations/messaging-infobip-vonage-telegram.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Infobip Omnichannel'"
echo "DONE."
