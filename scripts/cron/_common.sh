#!/usr/bin/env bash
# Shared helpers for HAIP scheduled job scripts.
set -euo pipefail

: "${HAIP_URL:?Set HAIP_URL (e.g. https://pms.example.com)}"

fetch_token() {
  if [ -n "${HAIP_CRON_TOKEN:-}" ]; then
    printf '%s' "$HAIP_CRON_TOKEN"
    return 0
  fi

  : "${KEYCLOAK_URL:?Set KEYCLOAK_URL or HAIP_CRON_TOKEN}"
  : "${KEYCLOAK_REALM:?Set KEYCLOAK_REALM (e.g. haip)}"
  : "${KEYCLOAK_CLIENT_ID:?Set KEYCLOAK_CLIENT_ID (cron service client)}"
  : "${KEYCLOAK_CLIENT_SECRET:?Set KEYCLOAK_CLIENT_SECRET}"

  local response token
  response=$(curl -sf \
    -X POST "${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
    --data-urlencode "client_secret=${KEYCLOAK_CLIENT_SECRET}")

  token=$(printf '%s' "$response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
  if [ -z "$token" ]; then
    echo "Failed to obtain access token from Keycloak" >&2
    exit 1
  fi
  printf '%s' "$token"
}

# POST to /api/v1/<path>. Extra curl args (e.g. -d '...') after the path.
api_post() {
  local path="$1"
  shift

  local token url tmp http_code
  token=$(fetch_token)
  url="${HAIP_URL%/}/api/v1/${path#/}"
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' RETURN

  http_code=$(curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "$url" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    "$@")

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    echo "POST ${url} failed with HTTP ${http_code}" >&2
    cat "$tmp" >&2
    exit 1
  fi

  cat "$tmp"
}
