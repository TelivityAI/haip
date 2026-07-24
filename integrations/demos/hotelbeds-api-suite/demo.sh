#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Hotelbeds API Suite (hotelbeds-api-suite) ==="
require_api
enable_registry 'hotelbeds-api-suite'
ensure_channel 'hotelbeds' 'hotelbeds'
echo "Note: Console channel adapter — no vendor HTTP until partner credentials."
print_live_hint "Partner API keys in connection config"
echo "Docs: docs/integrations/wave3-channels-wise.md"
echo "DONE."
