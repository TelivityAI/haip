#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Frankfurter/ECB FX (frankfurter-ecb-fx) ==="
require_api
enable_registry 'frankfurter-ecb-fx'
echo "→ Recipe: External Frankfurter/ECB rates recipe — convert outside HAIP."
print_live_hint "Scheduler calling Frankfurter HTTP API"
echo "Docs: docs/integrations/frankfurter-ecb-fx.md"
echo "DONE."
