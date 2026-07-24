#!/usr/bin/env bash
# One-command demo: Stripe
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Stripe (stripe) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'stripe'
echo "→ Payment demos use process env (restart API after setting PAYMENT_GATEWAY)."
echo "  Demo mode works with missing vendor keys (mock/console gateway)."

print_live_hint "STRIPE_MODE=test" "STRIPE_SECRET_KEY=sk_test_..."
echo
echo "Docs: docs/INTEGRATIONS.md#payments"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Stripe'"
echo "DONE."
