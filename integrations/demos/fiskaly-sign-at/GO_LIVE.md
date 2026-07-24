# Go live — fiskaly SIGN AT

## Demo (console)
```bash
./integrations/demos/run.sh fiskaly-sign-at
```
Sets `fiscalProviderKey`. Console provider logs handoff only.

## Live filing
1. Obtain market credentials / certified device access.
2. Replace the console `FiscalProvider` for key `fiskaly_sign_at` with a real client (same key).
3. Issue a test invoice (`invoice.requested`) and confirm a real external acknowledgement.

Docs: docs/integrations/fiskaly-sign-at.md
