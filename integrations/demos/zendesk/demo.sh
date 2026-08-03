#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"
echo "=== HAIP integration demo: Zendesk (zendesk) ==="
require_api
enable_registry 'zendesk'
echo "→ Recipe: Connect webhook recipe — sync guests/events in your middleware."
print_live_hint "Connect subscription callbackUrl" "CRM vendor API keys in middleware"
echo "Docs: docs/integrations/crm-webhooks.md"
echo "DONE."
