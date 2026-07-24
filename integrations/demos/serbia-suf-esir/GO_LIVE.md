# Go live — Serbia SUF/ESIR

## Demo (console)
```bash
./integrations/demos/run.sh serbia-suf-esir
```
Sets `fiscalProviderKey`. Console provider logs handoff only.

## Live filing
1. Obtain market credentials / certified device access.
2. Replace the console `FiscalProvider` for key `serbia_suf_esir` with a real client (same key).
3. Issue a test invoice (`invoice.requested`) and confirm a real external acknowledgement.

Docs: docs/integrations/serbia-fiscal.md
