#!/usr/bin/env bash
# One-command demo: SendGrid
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: SendGrid (sendgrid) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'sendgrid'
echo "→ Email: set SENDGRID_* for live; otherwise console/SMTP fallback."
echo "Note: Without SendGrid, email falls back to SMTP then console."

print_live_hint "SENDGRID_API_KEY=..." "SENDGRID_FROM=noreply@example.com"
echo
echo "Docs: docs/integrations/sendgrid-email.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'SendGrid'"
echo "DONE."
