#!/usr/bin/env bash
# Shared helpers for integration demos.
set -euo pipefail

HAIP_URL="${HAIP_URL:-http://localhost:3000}"
PROPERTY_ID="${PROPERTY_ID:-a0000001-0000-4000-a000-000000000001}"
API="${HAIP_URL%/}/api/v1"

haip_curl() {
  local method="$1"; shift
  local path="$1"; shift
  curl -sS -f -X "$method" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    "${API}${path}" \
    "$@"
}

require_api() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${API}/health" || true)"
  if [[ "$code" != "200" ]]; then
    echo "ERROR: HAIP API not reachable at ${API}/health (HTTP ${code:-down})" >&2
    echo "Start the demo stack first:" >&2
    echo "  docker compose up" >&2
    exit 1
  fi
}

enable_registry() {
  local slug="$1"
  echo "→ Enable catalog connection: ${slug}"
  haip_curl PUT "/admin/integrations/${slug}?propertyId=${PROPERTY_ID}" \
    -d '{"enabled":true,"config":{"demo":true,"source":"integrations/demos"}}' \
    >/dev/null
  echo "  OK (property Integrations toggle is ON)"
}

ensure_channel() {
  local adapter="$1"
  local code="$2"
  echo "→ Ensure channel connection adapterType=${adapter}"
  local list
  list="$(haip_curl GET "/channels/connections?propertyId=${PROPERTY_ID}" || echo '[]')"
  if echo "$list" | grep -q "\"adapterType\":\"${adapter}\""; then
    echo "  OK (connection already exists)"
    return 0
  fi
  haip_curl POST "/channels/connections" \
    -d "{\"propertyId\":\"${PROPERTY_ID}\",\"channelCode\":\"${code}\",\"channelName\":\"Demo ${code}\",\"adapterType\":\"${adapter}\",\"config\":{\"demo\":true}}" \
    >/dev/null
  echo "  OK (created demo connection — console/mock until credentials set)"
}

put_fiscal() {
  local body="$1"
  echo "→ PUT fiscal config"
  haip_curl PUT "/fiscal/config?propertyId=${PROPERTY_ID}" -d "$body" >/dev/null
  echo "  OK"
}

print_live_hint() {
  echo
  echo "Live credentials (optional — demos work without them):"
  if [[ "$#" -eq 0 ]]; then
    echo "  (none — console pack)"
    return 0
  fi
  for line in "$@"; do
    echo "  $line"
  done
}
