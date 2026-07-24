#!/usr/bin/env bash
# One-command demo: Amazon SES
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Amazon SES (amazon-ses) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
require_api
enable_registry 'amazon-ses'
echo "→ Requires SES_ENDPOINT gateway (honest path; no in-process SigV4)."
print_live_hint "SES_ENDPOINT=http://localhost:4566" "SES_API_KEY=local" "SES_FROM=noreply@example.com"
echo
echo "Docs: docs/integrations/mailgun-ses.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Amazon SES'"
echo "DONE."
