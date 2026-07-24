# GDS / CRS via channel manager

HAIP stores `booking_source = gds` and optional GDS chain/property codes on properties, but does **not** implement Amadeus/Sabre/Travelport hotel host adapters.

## Recommended path

1. Enable a **GDS channel** on SiteMinder or DerbySoft for the property.
2. Keep HAIP as the PMS of record; ARI + reservations flow through the existing CM adapter.
3. Map GDS rate/room codes in the Channels mappings UI.

## When to consider a CRS adapter later

Only if a corporate / chain mandate requires SynXis (or similar) HTNG connectivity directly. That is a separate partner-gated project — not part of this MVP.

## Config fields

- Property: `gds_chain_code`, `gds_property_id` (schema columns)
- Reservation / booking: source tag `gds` when the CM delivers a GDS-origin booking
