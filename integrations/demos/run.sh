#!/usr/bin/env bash
# Run one or all integration demos (shipped + adapter).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./lib.sh
source "$ROOT/lib.sh"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage:
  ./integrations/demos/run.sh list [shipped|adapters|all]
  ./integrations/demos/run.sh <slug>
  ./integrations/demos/run.sh all [shipped|adapters]
  ./integrations/demos/run.sh enable-all [shipped|adapters]

Env:
  HAIP_URL      default http://localhost:3000
  PROPERTY_ID   default demo hotel a0000001-0000-4000-a000-000000000001
EOF
}

# Prints slugs. $1 = all|shipped|adapters
slugs_for() {
  local filter="${1:-all}"
  FILTER="$filter" node <<'NODE'
const filter = process.env.FILTER || 'all';
const m = require('./manifest.json');
const isSerbia = (d) => d.slug === 'serbia-suf-esir' || d.slug === 'serbia-eturista';
const isAdapter = (d) =>
  (d.kind === 'fiscal' || d.kind === 'guest_reg') && !isSerbia(d);
const isShipped = (d) => !isAdapter(d);
for (const d of m.demos) {
  if (filter === 'adapters' && !isAdapter(d)) continue;
  if (filter === 'shipped' && !isShipped(d)) continue;
  console.log(d.slug);
}
NODE
}

list_slugs() {
  local filter="${1:-all}"
  FILTER="$filter" node <<'NODE'
const filter = process.env.FILTER || 'all';
const m = require('./manifest.json');
const isSerbia = (d) => d.slug === 'serbia-suf-esir' || d.slug === 'serbia-eturista';
const isAdapter = (d) =>
  (d.kind === 'fiscal' || d.kind === 'guest_reg') && !isSerbia(d);
const isShipped = (d) => !isAdapter(d);
for (const d of m.demos) {
  if (filter === 'adapters' && !isAdapter(d)) continue;
  if (filter === 'shipped' && !isShipped(d)) continue;
  const tag = isAdapter(d) ? 'adapter' : 'shipped';
  console.log(d.slug.padEnd(36), tag.padEnd(8), d.title);
}
NODE
}

cmd="${1:-}"
case "$cmd" in
  ""|-h|--help) usage; exit 0 ;;
  list) list_slugs "${2:-all}"; exit 0 ;;
  all)
    require_api
    fail=0
    while IFS= read -r slug; do
      [[ -z "$slug" ]] && continue
      echo
      if ! "$ROOT/$slug/demo.sh"; then
        echo "FAILED: $slug" >&2
        fail=1
      fi
    done < <(slugs_for "${2:-all}")
    exit "$fail"
    ;;
  enable-all)
    require_api
    while IFS= read -r slug; do
      [[ -z "$slug" ]] && continue
      enable_registry "$slug"
    done < <(slugs_for "${2:-all}")
    echo "Catalog toggles enabled for $PROPERTY_ID"
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
