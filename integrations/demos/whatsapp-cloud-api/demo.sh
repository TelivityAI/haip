#!/usr/bin/env bash
# One-command demo: WhatsApp Cloud API
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: WhatsApp Cloud API (whatsapp-cloud-api) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
require_api
enable_registry 'whatsapp-cloud-api'
echo "→ Without Cloud credentials, WhatsApp falls through to Twilio or console."
print_live_hint "WHATSAPP_CLOUD_TOKEN=EAAB..." "WHATSAPP_CLOUD_PHONE_NUMBER_ID=..."
echo
echo "Docs: docs/integrations/whatsapp-cloud.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'WhatsApp Cloud API'"
echo "DONE."
