#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: DATEV (datev) ==="
require_api
enable_registry 'datev'
echo "→ Recipe: CSV export recipe — map columns in your GL; no OAuth connector."
print_live_hint "Staff JWT with reports.view" "Map CSV to GL chart of accounts"
echo "Docs: docs/integrations/accounting-csv.md"
echo "DONE."
