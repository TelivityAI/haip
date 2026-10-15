# Discord Activity setup (view-only Repo Control)

This embeds the **same Repository Control UI** inside a Discord **voice channel** as an Activity. It is view-only: no refresh, annotations, or exports from Discord.

## What Discord requires

Activities are iframes. Discord’s proxy must reach your hosted origin (`*.discordsays.com` mapping). That means the Activity URL is **network-reachable**. Mitigations:

- Do not advertise the URL publicly.
- Set a strong `REPO_CONTROL_AUTH_TOKEN` for the browser UI.
- Set `REPO_CONTROL_DISCORD_PUBLIC_READ=true` only if you accept read-only snapshot visibility via the Activity proxy (mutations still require auth).
- Keep the GitHub repository private/public policy unchanged — this does not widen repo access.

## Portal steps (manual — you must do these)

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → New Application (e.g. `Telivity Repo Control`).
2. **OAuth2 → Redirects**: add `https://127.0.0.1` (placeholder; Embedded SDK handles Activity redirects).
3. Enable **Activities** for the application.
4. **Activities → URL Mappings**:
   - `/` → your private host (e.g. `haip-repo-control.onrender.com`)
   - optional `/api` → same host if you split API
5. Copy **Application ID** into hosted env `VITE_DISCORD_CLIENT_ID` / rebuild UI, and `DISCORD_CLIENT_ID`.
6. Invite the app to your **private** Discord server with Activity permissions.
7. Create a voice channel named e.g. `Repo Control`.
8. Join the channel → Start Activity → select the app.

## Local verification

```bash
cd tools/repo-control
export REPO_CONTROL_AUTH_TOKEN="$(openssl rand -hex 16)"   # local only — never commit
export REPO_CONTROL_DISCORD_PUBLIC_READ=true
pnpm serve
```

Open `http://localhost:8787/?discord=1` — UI should show **Discord view-only** and disable Refresh/annotations.

For a real Discord iframe locally, use an HTTPS tunnel (`cloudflared`) and set URL Mapping `/` to the tunnel host (see Discord Activity docs).

## Limits (honest)

- Agent cannot complete Developer Portal clicks or server invites for you.
- Without `VITE_DISCORD_CLIENT_ID`, the UI still enters view-only when `?discord=1` / `discordsays.com` is detected; SDK `ready()` is skipped.
- Activity “always on” means: people join the voice channel and launch/join the Activity. Discord does not wallpaper a text channel with a live SPA.
