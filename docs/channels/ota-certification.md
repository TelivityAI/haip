# OTA adapter certification / activation

HAIP ships adapters for:

| Adapter | Module path |
|---------|-------------|
| Booking.com | `apps/api/src/modules/channel/adapters/booking-com/` |
| Expedia EQC | `apps/api/src/modules/channel/adapters/expedia/` |
| SiteMinder pmsXchange | `apps/api/src/modules/channel/adapters/siteminder/` |
| DerbySoft Property Connector | `apps/api/src/modules/channel/adapters/derbysoft/` |

## Activation checklist

1. Create a channel connection in the dashboard (Channels) with credentials from the partner portal.
2. Map room types and rate plans.
3. Push ARI / content as supported by the adapter.
4. Confirm inbound reservation webhooks with a test booking.
5. Monitor rate parity UI for drift.

## Partner gates (honest)

- **Booking.com Connectivity** and **Expedia System Provider** status are commercial — code alone does not make a live hotel connection without partner onboarding (or routing via SiteMinder/DerbySoft).
- Prefer **DerbySoft / SiteMinder** for long-tail OTAs instead of writing new direct adapters.
- Next direct OTA (e.g. Agoda) only when there is an open supply partner program and a market need.

See also: [derbysoft.md](./derbysoft.md).
