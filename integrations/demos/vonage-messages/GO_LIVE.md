# Go live — Vonage Messages

## Demo
```bash
./integrations/demos/run.sh vonage-messages
```
Without keys SMS falls through to **console** (logged).

## Live in a jiffy
1. Fill [`demo.env.example`](./demo.env.example) live vars in `.env`.
2. Set `SMS_PROVIDER` (see example) and restart API.
3. Trigger a reservation SMS; confirm delivery in the vendor console.

Docs: docs/integrations/messaging-infobip-vonage-telegram.md
