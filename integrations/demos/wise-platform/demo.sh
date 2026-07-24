#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Wise Platform (wise-platform) ==="
require_api
enable_registry 'wise-platform'
echo "→ Set PAYMENT_GATEWAY=wise and restart API (console until Wise partner client)."
echo "Note: Console payment gateway (PAYMENT_GATEWAY=wise) until Wise Platform partner client lands."
print_live_hint "PAYMENT_GATEWAY=wise" "WISE_API_TOKEN=..." "WISE_PROFILE_ID=..."
echo "Docs: docs/integrations/wave3-channels-wise.md"
echo "DONE."
