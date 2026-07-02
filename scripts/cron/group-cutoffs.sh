#!/usr/bin/env bash
# Release expired group allotment blocks (auto-release cutoff sweep).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

: "${HAIP_PROPERTY_ID:?Set HAIP_PROPERTY_ID (property UUID)}"

api_post "groups/blocks/process-cutoffs?propertyId=${HAIP_PROPERTY_ID}"

echo "Group cutoff sweep completed for ${HAIP_PROPERTY_ID}"
