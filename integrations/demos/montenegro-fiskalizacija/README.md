# Montenegro Fiskalizacija — adapter demo

**Status:** `adapter` (console handoff — not live authority filing)

```bash
./integrations/demos/run.sh montenegro-fiskalizacija
```

## What this demo does
1. Turns ON the Integrations catalog toggle for `montenegro-fiskalizacija`.
2. Sets property fiscal/guest-reg provider key to `montenegro_fiskalizacija`.
3. Core **logs** the handoff and returns a fake acknowledgement — no tax/police API calls.

## Go live in a jiffy (real filing)
1. Get credentials / certificates from the authority or certified partner for this market.
2. Implement (or drop in) a real `FiscalProvider` / `GuestRegistrationProvider` registered under key `montenegro_fiskalizacija`.
3. Keep using the same `PUT /api/v1/fiscal/config?propertyId=` body — only the provider implementation changes.
4. Re-run a check-in / invoice flow and confirm an external acknowledgement id from the authority.

Until step 2–3 exist, this pack is for **wiring and demos only**.

Docs: [docs/integrations/wave3-fiscal-guest-reg.md](../../docs/integrations/wave3-fiscal-guest-reg.md)
