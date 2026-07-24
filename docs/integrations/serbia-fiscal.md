# Serbia fiscal and guest registration (framework)

This note describes how HAIP wires **property-level provider keys** for Serbian compliance integrations named in the [integration catalog](../INTEGRATIONS.md). HAIP core does **not** embed tax authority or police APIs; it stores configuration, listens for lifecycle events, and delegates to a registered provider (console/demo adapters ship in-repo; production credentials belong in your deployment secrets story).

## Provider keys

| Concern | Provider key | Catalog name |
|---------|--------------|----------------|
| Fiscal receipts / fiscal device workflow | `serbia_suf_esir` | Serbia SUF/ESIR |
| Guest registration | `serbia_eturista` | Serbia eTurista |

Configure per property via:

- `GET /api/v1/fiscal/config?propertyId=<uuid>`
- `PUT /api/v1/fiscal/config?propertyId=<uuid>`

Example body (core does not interpret `fiscalConfig` / `guestRegistrationConfig` — pass through fields required by your adapter or external middleware):

```json
{
  "fiscalProviderKey": "serbia_suf_esir",
  "documentType": "serbia_suf_esir",
  "fiscalConfig": {
    "credentials": {}
  },
  "guestRegistrationProviderKey": "serbia_eturista",
  "guestRegistrationConfig": {
    "credentials": {}
  }
}
```

Store sensitive values using the same operational pattern as other integration configs (encrypted JSON at the application layer when available). Core persists config under `properties.settings.fiscal` and `properties.settings.guestRegistration`.

## Fiscal documents (`invoice.*`)

HAIP follows the generic fiscal document flow documented in [Webhooks & events](../webhooks.md#fiscal-documents-invoice):

1. Request a document on a folio (`POST /api/v1/folios/:folioId/fiscal-documents`) → **`invoice.requested`**.
2. When a fiscal provider is configured, the in-process listener calls the provider and then records issuance via `FiscalDocumentService.issue()` (same as an external integration calling the issue endpoint).
3. Voiding still uses the folio fiscal-document void API → **`invoice.voided`**.

With no provider configured, step 2 is a no-op and external subscribers can handle **`invoice.requested`** as today.

## Guest registration (check-in / check-out)

When `guestRegistrationProviderKey` is set, HAIP calls the provider on:

- **`reservation.checked_in`**
- **`reservation.checked_out`**

Reports are audit-logged; core does not interpret guest identity fields beyond what is already on the reservation record.

## Console adapters

`serbia_suf_esir` and `serbia_eturista` console providers log handoffs and return deterministic mock external ids — useful for demos without government credentials.

For production SUF/ESIR or eTurista connectivity, implement the `FiscalProvider` / `GuestRegistrationProvider` interfaces and register the adapter in `FiscalModule`.
