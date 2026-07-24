#!/usr/bin/env bash
# One-command demo: Braintree
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Braintree (braintree) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'braintree'
echo "→ Payment demos use process env (restart API after setting PAYMENT_GATEWAY)."
echo "  Demo mode works with missing vendor keys (mock/console gateway)."

print_live_hint "BRAINTREE_MERCHANT_ID=..." "BRAINTREE_PUBLIC_KEY=..." "BRAINTREE_PRIVATE_KEY=..."
echo
echo "Docs: docs/integrations/payments-adyen-mollie-square-braintree.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Braintree'"
echo "DONE."
