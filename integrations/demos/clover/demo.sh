#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Clover (clover) ==="
require_api
enable_registry 'clover'
echo "→ Recipe: Folio-inbound POS recipe — middleware posts charges with Connect API key."
print_live_hint "Connect API key (property-scoped)" "POS middleware \u2192 POST /folio-inbound/charges"
echo "Docs: docs/integrations/folio-inbound-pos.md"
echo "DONE."
