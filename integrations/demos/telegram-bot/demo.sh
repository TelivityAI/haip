#!/usr/bin/env bash
# One-command demo: Telegram Bot
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

echo "=== HAIP integration demo: Telegram Bot (telegram-bot) ==="
echo "API: $HAIP_URL  property: $PROPERTY_ID"

require_api
enable_registry 'telegram-bot'
echo "→ Messaging: set provider env and restart API (console fallback without keys)."

print_live_hint "TELEGRAM_BOT_TOKEN=123456:ABC..."
echo
echo "Docs: docs/integrations/messaging-infobip-vonage-telegram.md"
echo "Dashboard: $HAIP_URL → Integrations → enable 'Telegram Bot'"
echo "DONE."
