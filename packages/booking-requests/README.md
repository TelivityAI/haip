# @telivityhaip/booking-requests

Optional request-first direct booking for HAIP (STR / coliving workflows).

## Enable

1. Run core migrations: `pnpm db:migrate`
2. Run booking-requests migrations: `pnpm db:migrate:booking-requests`
3. Set `HAIP_BOOKING_REQUESTS=true` in `apps/api/.env`
4. Set property `bookingMode=request` in booking engine admin settings

When disabled (default), core HAIP instant booking is unchanged.

## Credit

Original implementation by [@agustinjch](https://github.com/agustinjch).
