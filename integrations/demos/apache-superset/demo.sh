#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Apache Superset (apache-superset) ==="
require_api
enable_registry 'apache-superset'
echo "→ Recipe: Read-only Postgres / export recipe — no embedded BI vendor client."
print_live_hint "Read-only Postgres role for BI tool"
echo "Docs: docs/integrations/bi-postgres.md"
echo "DONE."
