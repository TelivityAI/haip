# fiskaly SIGN AT (RKSV) — fiscal provider

HAIP wires **property-level fiscal provider keys**. Core does **not** embed fiskaly or Austrian RKSV APIs; it stores configuration, listens for `invoice.requested`, and delegates to a registered provider.

## Provider key

| Concern | Provider key | Catalog name |
|---------|--------------|----------------|
| Austrian RKSV receipt signing | `fiskaly_sign_at` | fiskaly SIGN AT |

Configure via:

- `GET /api/v1/fiscal/config?propertyId=<uuid>`
- `PUT /api/v1/fiscal/config?propertyId=<uuid>`

```json
{
  "fiscalProviderKey": "fiskaly_sign_at",
  "documentType": "fiskaly_sign_at",
  "fiscalConfig": {
    "credentials": {}
  }
}
```

Pass-through `fiscalConfig` fields belong to your deployment secrets story (API keys, TSS id, etc.). Core does not interpret them beyond handing them to the provider.

## Console adapter

The in-repo `fiskaly_sign_at` provider is a **console/demo** adapter: it logs the handoff and returns a deterministic external id. Use it for demos without fiskaly credentials.

For production SIGN AT connectivity, implement `FiscalProvider` against fiskaly partner docs and register the adapter in `FiscalModule` (same pattern as Serbia SUF/ESIR).

## Related

- German TSE: provider key `fiskaly_sign_de` (console pack; same framework)
- Framework overview: [Serbia fiscal recipe](serbia-fiscal.md) (config + event flow)
- Catalog: [Fiscalization & Tax Compliance](../INTEGRATIONS.md#fiscalization--tax-compliance-worldwide)
