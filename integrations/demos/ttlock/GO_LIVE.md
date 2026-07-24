# Go live — TTLock

## Demo
```bash
./integrations/demos/run.sh ttlock
```
Toggle ON. Without keys the lock factory falls back to **console**.

## Live in a jiffy
1. Put keys from [`demo.env.example`](./demo.env.example) into `.env`.
2. `DOOR_LOCK_PROVIDER=ttlock` then restart API.
3. Issue a code on check-in; confirm the vendor dashboard shows the grant.
4. Revoke on check-out.

Docs: docs/integrations/door-locks-nuki-ttlock-salto.md
