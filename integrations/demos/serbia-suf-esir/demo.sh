#!/usr/bin/env bash
# One-command demo: Serbia SUF/ESIR
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Serbia SUF/ESIR (serbia-suf-esir) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'serbia-suf-esir'
put_fiscal '{"fiscalProviderKey":"serbia_suf_esir","documentType":"serbia_suf_esir","fiscalConfig":{"demo":true}}'
echo "Note: Console fiscal provider — logs handoff; replace with authority client for production."

print_live_hint
echo
echo "Docs: docs/integrations/serbia-fiscal.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Serbia SUF/ESIR'"
echo "DONE."
