#!/usr/bin/env bash
# One-command demo: Mailgun
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Mailgun (mailgun) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"
require_api
enable_registry 'mailgun'
echo "→ Without Mailgun keys, email falls through to SendGrid/SMTP/console."
print_live_hint "MAILGUN_API_KEY=..." "MAILGUN_DOMAIN=mg.example.com"
echo
echo "Docs: docs/integrations/mailgun-ses.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Mailgun'"
echo "DONE."
