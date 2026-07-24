# Go live — SII

## Demo (console)
```bash
./integrations/demos/run.sh sii
```
Sets `fiscalProviderKey`. Console provider logs handoff only.

## Live filing
1. Obtain market credentials / certified device access.
2. Replace the console `FiscalProvider` for key `spain_sii` with a real client (same key).
3. Issue a test invoice (`invoice.requested`) and confirm a real external acknowledgement.

Docs: docs/integrations/wave3-fiscal-guest-reg.md
