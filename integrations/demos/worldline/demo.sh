#!/usr/bin/env bash
# One-command demo: Worldline Online Payments
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Worldline Online Payments (worldline) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'worldline'
echo "→ Payment demos use process env (restart API after setting PAYMENT_GATEWAY)."
echo "  Missing merchant credentials fail closed. For an offline demo select PAYMENT_GATEWAY=mock."
echo "  Test host is payment.preprod.direct.worldline-solutions.com (WORLDLINE_ENV=test)."

print_live_hint "WORLDLINE_MERCHANT_ID=... WORLDLINE_API_KEY_ID=... WORLDLINE_SECRET_API_KEY=..."
echo
echo "Docs: docs/integrations/payments-worldline.md"
echo "Dashboard: Integrations → enable Worldline and enter the PSPID, API key id, and secret"
echo "DONE."
