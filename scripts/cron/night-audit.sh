#!/usr/bin/env bash
# Run night audit for one property. Requires JWT (see README.md).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

: "${HAIP_PROPERTY_ID:?Set HAIP_PROPERTY_ID (property UUID)}"

if [ -z "${HAIP_BUSINESS_DATE:-}" ]; then
  if date -u -d 'yesterday' +%Y-%m-%d >/dev/null 2>&1; then
    HAIP_BUSINESS_DATE=$(date -u -d 'yesterday' +%Y-%m-%d)
  else
    HAIP_BUSINESS_DATE=$(date -u -v-1d +%Y-%m-%d)
  fi
fi

api_post 'night-audit/run' \
  -d "{\"propertyId\":\"${HAIP_PROPERTY_ID}\",\"businessDate\":\"${HAIP_BUSINESS_DATE}\"}"

echo "Night audit completed for ${HAIP_PROPERTY_ID} (${HAIP_BUSINESS_DATE})"
