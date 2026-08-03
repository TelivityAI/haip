#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Amadeus Self-Service Hotel APIs (amadeus-self-service-hotel-apis) ==="
require_api
enable_registry 'amadeus-self-service-hotel-apis'
ensure_channel 'amadeus_hotel' 'amadeus_hotel'
echo "Note: Console channel adapter — no vendor HTTP until partner credentials."
print_live_hint "Partner API keys in connection config"
echo "Docs: docs/integrations/wave3-channels-wise.md"
echo "DONE."
