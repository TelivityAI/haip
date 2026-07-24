#!/usr/bin/env bash
# Run one or all shipped integration demos.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib.sh
source "$ROOT/lib.sh"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage:
  ./integrations/demos/run.sh list
  ./integrations/demos/run.sh <slug>
  ./integrations/demos/run.sh all
  ./integrations/demos/run.sh enable-all

Env:
  HAIP_URL      default http://localhost:3000
  PROPERTY_ID   default demo hotel a0000001-0000-4000-a000-000000000001

Examples:
  docker compose up -d
  ./integrations/demos/run.sh stripe
  ./integrations/demos/run.sh all
EOF
}

list_slugs() {
  node -e "const m=require('./manifest.json'); m.demos.forEach(d=>console.log(d.slug.padEnd(36), d.title))"
}

cmd="${1:-}"
case "$cmd" in
  ""|-h|--help) usage; exit 0 ;;
  list) list_slugs; exit 0 ;;
  all)
    require_api
    fail=0
    while IFS= read -r slug; do
      echo
      if ! "$ROOT/$slug/demo.sh"; then
        echo "FAILED: $slug" >&2
        fail=1
      fi
    done < <(node -e "require('./manifest.json').demos.forEach(d=>console.log(d.slug))")
    exit "$fail"
    ;;
  enable-all)
    require_api
    while IFS= read -r slug; do
      enable_registry "$slug"
    done < <(node -e "require('./manifest.json').demos.forEach(d=>console.log(d.slug))")
    echo "All shipped catalog toggles enabled for $PROPERTY_ID"
    ;;
  *)
    if [[ ! -x "$ROOT/$cmd/demo.sh" ]]; then
      echo "Unknown demo slug: $cmd" >&2
      echo "Run: ./integrations/demos/run.sh list" >&2
      exit 1
    fi
    exec "$ROOT/$cmd/demo.sh"
    ;;
esac
