#!/usr/bin/env bash
# One-command demo: Adyen
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Adyen (adyen) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'adyen'
echo "→ Payment demos use process env (restart API after setting PAYMENT_GATEWAY)."
echo "  Demo mode works with missing vendor keys (mock/console gateway)."
echo "Note: Without credentials the gateway uses console mode (logged, no charge)."

print_live_hint "ADYEN_API_KEY=..." "ADYEN_MERCHANT_ACCOUNT=..."
echo
echo "Docs: docs/integrations/payments-adyen-mollie-square-braintree.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Adyen'"
echo "DONE."
