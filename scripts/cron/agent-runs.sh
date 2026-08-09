#!/usr/bin/env bash
# Run one HAIP AI agent for a property (external cron).
# Usage: agent-runs.sh <agentType>
# Example: agent-runs.sh revenue_manager
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

: "${HAIP_PROPERTY_ID:?Set HAIP_PROPERTY_ID (property UUID)}"

AGENT_TYPE="${1:-${HAIP_AGENT_TYPE:-}}"
if [ -z "${AGENT_TYPE}" ]; then
  echo "Usage: $0 <agentType>   (or set HAIP_AGENT_TYPE)" >&2
  echo "Typical: revenue_manager | housekeeping | cancellation | ar_collections | night_audit | guest_comms" >&2
  exit 1
fi

api_post "agents/${HAIP_PROPERTY_ID}/${AGENT_TYPE}/run?triggeredBy=schedule"

echo "Agent ${AGENT_TYPE} run completed for ${HAIP_PROPERTY_ID}"
