# Nuki, TTLock, and Salto KS door locks

HAIP provisions and revokes room access on check-in / check-out through the `LockProvider` interface. Core ships reference adapters for **Nuki**, **TTLock**, and **Salto KS**, plus the default **webhook** adapter and a **console** fallback when vendor credentials are missing.

See the catalog entries in **[Integration catalog](../INTEGRATIONS.md)** (Door Locks & Access).

## Select a provider

Set on the API container:

```bash
DOOR_LOCK_PROVIDER=webhook   # default — emits door.access_* webhooks
DOOR_LOCK_PROVIDER=nuki
DOOR_LOCK_PROVIDER=ttlock
DOOR_LOCK_PROVIDER=salto_ks
DOOR_LOCK_PROVIDER=console   # log-only PIN (dev / demo)
```

If `DOOR_LOCK_PROVIDER` names a vendor that is not fully configured, HAIP falls back to **console** (PIN is generated and stored locally; nothing is sent to the vendor).

## Nuki

```bash
NUKI_API_TOKEN=...
NUKI_SMARTLOCK_ID=...   # lock id from the Nuki Web API
```

Uses the Nuki Web API to create and delete keypad authorizations for the configured smart lock.

## TTLock

```bash
TTLOCK_CLIENT_ID=...
TTLOCK_CLIENT_SECRET=...
TTLOCK_USERNAME=...
TTLOCK_PASSWORD=...
TTLOCK_LOCK_ID=...
# optional:
TTLOCK_API_BASE=https://euapi.ttlock.com
```

Uses the TTLock Open API keyboard-PIN workflow (OAuth password grant + add/delete PIN).

## Salto KS

```bash
SALTO_KS_CLIENT_ID=...
SALTO_KS_CLIENT_SECRET=...
SALTO_KS_SITE_ID=...
# optional:
SALTO_KS_API_BASE=https://api.saltoks.com
SALTO_KS_IDENTITY_BASE=https://identity-acc.saltoks.com
```

Uses Salto KS Cloud OAuth (client credentials) to create and remove site users with PIN access.

## Operations and audit

- Credentials are stored per property/reservation; front desk can list and reissue via **`GET/POST /api/v1/door-lock/credentials`** (see **[Webhooks & events](../webhooks.md)** for webhook payloads when using `webhook`).
- Check-in and check-out listeners never throw on vendor errors — failures are logged so guest flow continues.

## Self-hosting notes

Vendor SDKs are not bundled. Adapters call vendor HTTPS APIs with `fetch`. Swap or extend adapters by rebinding `LOCK_PROVIDER` in `DoorLockModule` if you need custom middleware.
