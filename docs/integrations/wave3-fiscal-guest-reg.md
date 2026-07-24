# Wave 3 fiscal & guest-registration console packs

Country packs beyond Serbia ship as **console FiscalProvider / GuestRegistrationProvider** keys until KB-driven authority clients and partner credentials exist. Core never invents tax or police API payloads.

## Fiscal provider keys

| Key | Catalog | Wave |
|-----|---------|------|
| `fiskaly_sign_at` | fiskaly SIGN AT | Wave 2 leftover |
| `fiskaly_sign_de` | fiskaly SIGN DE | Wave 3 |
| `croatia_fiskalizacija_2` | Croatia Fiskalizacija 2.0 | Wave 3 |
| `slovenia_furs` | Slovenia FURS | Wave 3 |
| `vies` | VIES | Wave 3 |
| `nbs_exchange_rates` | NBS exchange rates | Wave 3 |
| `north_macedonia_efaktura` | North Macedonia e-Faktura | Wave 3 |
| `bih_fiscalization` | BiH fiscalization | Wave 3 |
| `montenegro_fiskalizacija` | Montenegro Fiskalizacija | Wave 3 |
| `belgium_peppol_b2b` | Belgium Peppol B2B | Wave 3 |
| `luxembourg_peppol` | Luxembourg Peppol | Wave 3 |
| `ireland_vat_modernisation` | Ireland VAT Modernisation | Wave 3 |
| `uk_mtd_vat` | UK MTD VAT | Wave 3 |
| `swiss_qr_bill` | Swiss QR-bill | Wave 3 |
| `italy_sdi` | Italy SDI | Wave 3 |
| `spain_verifactu` | Spain VeriFactu | Wave 3 |
| `spain_ticketbai` | TicketBAI | Wave 3 |
| `spain_sii` | Spain SII | Wave 3 |
| `greece_mydata` | Greece myDATA | Wave 3 |
| `estonia_einvoicing` | Estonia e-invoicing | Wave 3 |
| `latvia_vid` | Latvia VID | Wave 3 |
| `poland_ksef` | Poland KSeF | Wave 3 |
| `hungary_nav_3` | Hungary NAV 3.0 | Wave 3 |
| `hungary_ntak` | Hungary NTAK | Wave 3 |
| `romania_ro_efactura` | Romania RO e-Factura | Wave 3 |
| `mexico_cfdi` | Mexico CFDI | Wave 3 |
| `el_salvador_dte` | El Salvador DTE | Wave 3 |
| `colombia_dian` | Colombia DIAN | Wave 3 |
| `ecuador_sri` | Ecuador SRI | Wave 3 |

Brazil fiscalization remains outside this pack (local contributor).

Set `fiscalProviderKey` via `PUT /api/v1/fiscal/config?propertyId=`.

## Guest-registration provider keys (console)

| Key | Catalog |
|-----|---------|
| `luxembourg_fiches` | Luxembourg fiches d'hébergement |
| `portugal_siba` | Portugal SIBA |
| `andorra_roat` | Andorra ROAT |
| `czechia_ubyport` | Czechia Ubyport |
| `finland_matkustajailmoitus` | Finland Matkustajailmoitus |
| `uruguay_rihp` | Uruguay RIHP |
| `croatia_evisitor` | Croatia eVisitor |
| `italy_alloggiati` | Italy Alloggiati Web |

Set `guestRegistrationProviderKey` on the same fiscal config endpoint.

## Build order (GTM)

Serbia (shipped) → Croatia → Slovenia → fiskaly DE/AT → Italy SDI → Greece myDATA → Hungary NAV → Poland KSeF → Spain → Peppol BE/LU/IE → UK MTD → Swiss QR-bill → LatAm CFDI/DTE/DIAN/SRI → remaining.
