#!/usr/bin/env bash
# One-command demo: Redsys
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Redsys (redsys) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'redsys'
echo "→ Payment demos use process env (restart API after setting PAYMENT_GATEWAY)."
echo "  For a deliberate offline demo select PAYMENT_GATEWAY=mock; unconfigured Redsys fails closed."
echo "  For live/sandbox redirect: set REDSYS_MERCHANT_CODE / REDSYS_TERMINAL / REDSYS_SECRET_KEY / REDSYS_ENV=test"
echo "  and PUBLIC_API_BASE_URL to a URL Redsys can reach for MerchantURL notifications."

print_live_hint "REDSYS_MERCHANT_CODE=... REDSYS_SECRET_KEY=..."
echo
echo "Docs: docs/integrations/payments-redsys.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Redsys' and enter FUC credentials"
echo "DONE."
