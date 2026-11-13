#!/usr/bin/env bash
# Close every hotel whose local night-audit hour has passed.
# Auth is HAIP_SERVICE_TOKEN (the API returns 503 when it is unset).
# This does not print the token.
set -euo pipefail

: "${HAIP_URL:?Set HAIP_URL (e.g. https://pms.example.com)}"
: "${HAIP_SERVICE_TOKEN:?Set HAIP_SERVICE_TOKEN}"

body="${NIGHT_AUDIT_DUE_BODY:-{}}"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

http_code=$(curl -sS -o "$tmp" -w '%{http_code}' \
  -X POST "${HAIP_URL%/}/api/v1/night-audit/run-due" \
  -H "Authorization: Bearer ${HAIP_SERVICE_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$body")

cat "$tmp"
echo
if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
  echo "POST night-audit/run-due failed with HTTP ${http_code}" >&2
  exit 1
fi
