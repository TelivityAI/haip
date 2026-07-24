# Wave 3 partner surface (registry)

Wave 3 catalog rows span **shipped**, **adapter**, **recipe**, and remaining **planned** partner/cert work. Status meanings: see [INTEGRATIONS.md — Catalog status](../INTEGRATIONS.md#catalog-status-registry).

- `shipped` = in-product HTTP-capable path (mock/console until live keys)
- `adapter` = named console provider / channel adapter wired (handoff logged; not live vendor traffic)
- `recipe` = docs on existing REST / webhooks / CSV / SQL — no Nest vendor client
- `planned` = partner apply / cert / new module not started

After `pnpm migrate` / push-schema, browse `GET /api/v1/admin/integrations` (and the property Integrations dashboard). One-command demos: [`integrations/demos/`](../../integrations/demos/).

## Tier A/B shipped in this wave (50)

| Slice | Status | Count | Surface |
|-------|--------|------:|---------|
| Messaging + email | `shipped` | 3 | WhatsApp Cloud, Mailgun, Amazon SES gateway — [whatsapp-cloud.md](whatsapp-cloud.md), [mailgun-ses.md](mailgun-ses.md) |
| Channel managers + Wise | `adapter` | 12 | 11 NamedConsoleChannelAdapters + Wise console payment — [wave3-channels-wise.md](wave3-channels-wise.md) |
| Reviews & reputation | `adapter` | 9 | Named console review sources — [wave3-reviews.md](wave3-reviews.md) |
| BI / accounting / POS / CRM / FX | `recipe` | 26 | [bi-postgres.md](bi-postgres.md), [accounting-csv.md](accounting-csv.md), [folio-inbound-pos.md](folio-inbound-pos.md), [crm-webhooks.md](crm-webhooks.md), [frankfurter-ecb-fx.md](frankfurter-ecb-fx.md) |

Skip meta rows (still planned / not Tier A/B demos): `channel-manager-cert-queue`, `channel-manager-mapping-studio`.

## Still planned (partner/cert / out of Tier A/B)

| Category | Notes |
|----------|-------|
| Upsells & ancillaries | Partner APIs (Duve, …) |
| Housekeeping & ops | Flexkeeping, Quore, … |
| OTA direct / metasearch / RMS | Partner feeds |
| ID verification & check-in | New modules |
| Automation platforms | Zapier/Make/IFTTT **partner app** listings (webhook recipes already exist) |
| Compliance-22 / live fiscal beyond console | Market entry |
| Demand360 / Top-Report | Partner BI |
| Documenso / Dropbox Sign / Outlook Graph / OpenTravel | Open standards packs |
| Extra messaging (HiJiffy, Instagram, RCS, Chatwoot, Viber, LINE, Sinch) | Beyond Cloud WhatsApp / Infobip / Vonage / Telegram / Bird |

## Earlier Wave 3 console packs (fiscal / guest-reg)

Country fiscalization and guest-registration console keys (Brazil excluded): [wave3-fiscal-guest-reg.md](wave3-fiscal-guest-reg.md). Paid/gated packs: [compliance-market-entry.md](compliance-market-entry.md).

## How to promote a `planned` row

1. Complete vendor partner apply / sandbox signup outside HAIP.
2. Implement the matching provider interface (or document a recipe on existing APIs).
3. Flip registry seed `status` / `adapterKey` / `docsPath`, add `integrations/demos/<slug>/` (`demo.sh` + `GO_LIVE.md`), and update this page.

Do **not** invent government or vendor API contracts.
