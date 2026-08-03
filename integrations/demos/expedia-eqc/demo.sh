#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Expedia EQC (expedia-eqc) ==="
require_api
enable_registry 'expedia-eqc'
ensure_channel 'expedia_eqc' 'expedia_eqc'
echo "Note: Console channel adapter — no vendor HTTP until partner credentials."
print_live_hint "Partner API keys in connection config"
echo "Docs: docs/integrations/wave3-channels-wise.md"
echo "DONE."
