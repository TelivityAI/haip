# Wave 3 partner surface (registry)

Wave 3 items are **new surface / partner processes**: start partner applications and certification where required; implement adapters when credentials and domain docs exist. They appear in the integration registry as `planned` (or `adapter` when a console handoff key is wired).

After `pnpm migrate` / push-schema, browse `GET /api/v1/admin/integrations` (and the property Integrations dashboard).

## Category buckets (146)

| Category | Count | Notes |
|----------|------:|-------|
| Fiscalization & tax | 28 | Console `FiscalProvider` keys; Brazil excluded |
| Channel managers | 13 | Partner/cert connectivity beyond SiteMinder/DerbySoft/Beds24/Channex |
| Upsells & ancillaries | 12 | Partner APIs |
| Metasearch & direct booking | 10 | Feed/partner programs |
| Guest messaging | 9 | Beyond Infobip/Vonage/Telegram/Bird |
| Revenue management | 9 | Partner RMS connectivity |
| Reviews & reputation | 9 | Beyond Google/TripAdvisor stubs |
| ID verification & check-in | 8 | Veriff, Civitfun, eVisitor, … |
| Point of sale | 8 | Beyond folio inbound recipe |
| Accounting & ERP | 7 | QBO/Xero/Sage/… |
| Email, marketing & CRM | 7 | Beyond SendGrid |
| Guest registration | 6 | Country packs (console providers) |
| OTA direct | 5 | Expedia Rapid, Airbnb Partner, … |
| BI & analytics | 4 | Superset, Looker Studio, Demand360, Top-Report |
| Misc / open standards | 4 | Documenso, Dropbox Sign, Outlook/Graph, OpenTravel/HTNG |
| Automation platforms | 3 | Zapier/Make/IFTTT **partner app** listings |
| Housekeeping & ops | 3 | Flexkeeping, Quore, Duve HK |
| Payments | 1 | Wise Platform |

## How to enable a planned row

1. Complete vendor partner apply / sandbox signup outside HAIP.
2. Implement the matching provider interface (channel, payment, lock, fiscal, messaging, or a new module when required).
3. Flip registry seed `status` / `adapterKey` and ship a public recipe under `docs/integrations/`.

Do **not** invent government or vendor API contracts. Fiscal/guest-reg console keys: [wave3-fiscal-guest-reg.md](wave3-fiscal-guest-reg.md). Paid/gated packs: [compliance-market-entry.md](compliance-market-entry.md).
