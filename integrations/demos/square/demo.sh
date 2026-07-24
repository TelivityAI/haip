#!/usr/bin/env bash
# One-command demo: Square
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Square (square) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'square'
echo "→ Payment demos use process env (restart API after setting PAYMENT_GATEWAY)."
echo "  Demo mode works with missing vendor keys (mock/console gateway)."

print_live_hint "SQUARE_ACCESS_TOKEN=..." "SQUARE_LOCATION_ID=..."
echo
echo "Docs: docs/integrations/payments-adyen-mollie-square-braintree.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Square'"
echo "DONE."
