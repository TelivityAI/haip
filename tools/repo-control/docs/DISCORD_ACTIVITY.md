# Put Repo Control in Discord (primary path)

Goal: a dedicated voice channel where the team opens the channel and sees the **view-only** Repository Control board as a Discord Activity.

Contributors who are not in Discord can use the **same host** via **Clerk email sign-up** (view-only web). That path is separate — see README.

## Reality check

| Want | Discord mechanism |
|------|-------------------|
| UI **inside** Discord | **Activity** (Embedded App) in a **voice** channel |
| Text-channel wallpaper SPA | **Not supported** by Discord |
| “Always there” | Keep the Activity running in that voice channel; members join channel → join Activity |

There is still an HTTPS origin behind the Activity. That host is plumbing for Discord’s iframe proxy — not a separate product people should use in a browser.

## One-time Discord Developer Portal

You (human) must do these — no agent can click your portal:

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** (e.g. `Telivity Repo Control`).
2. **OAuth2 → Redirects**: add `https://127.0.0.1` (placeholder).
3. Enable **Activities**.
4. **Activities → URL Mappings**
   - Prefix `/` → Activity origin host (no `https://` in TARGET): `telivity-repo-control.onrender.com`
5. Copy **Application ID** (already: `1560400786767220806` for Haip Dashboard).
6. Invite the bot with permissions integer `549756863504` (Manage Channels, View Channels, Connect, Use Embedded Activities):
   - https://discord.com/oauth2/authorize?client_id=1560400786767220806&permissions=549756863504&integration_type=0&scope=bot%20applications.commands
7. Create voice channel: `Repo Control` (or run `node scripts/discord-setup-channel.mjs` after invite).
8. Join channel → **Start Activity** → pick **Haip Dashboard**. Leave it running.

## Activity origin env (host secrets — never commit)

```bash
REPO_CONTROL_DISCORD_PUBLIC_READ=true
REPO_CONTROL_AUTH_TOKEN=<strong random — for rare direct hits to origin>
VITE_DISCORD_CLIENT_ID=<Discord Application ID>
NODE_ENV=production
```

Rebuild UI after setting `VITE_DISCORD_CLIENT_ID` (`pnpm build:ui`).

`DISCORD_PUBLIC_READ=true` lets Discord’s proxy load the snapshot/UI. Mutations (refresh/annotations) still require the auth token and are disabled in the Activity UI.

## Local tunnel test (optional)

```bash
cd tools/repo-control
pnpm install --ignore-workspace
pnpm exec tsx src/analyze.ts --skip-checks
pnpm build:ui
export REPO_CONTROL_DISCORD_PUBLIC_READ=true
export REPO_CONTROL_AUTH_TOKEN="$(openssl rand -hex 16)"
export VITE_DISCORD_CLIENT_ID="<Application ID>"
pnpm serve
# separate terminal:
cloudflared tunnel --url http://localhost:8787
```

Map portal `/` → the cloudflared host, then Start Activity against that mapping.

## What “done in Discord” looks like

- Voice channel `Repo Control` exists  
- Activity launches and shows Telivity Repo Control board  
- Yellow **Discord view-only** mode (no Refresh)  
- Graphify tile opens inside the Activity  
- Snapshot data from last analyze  

## Blockers only you can clear

- Discord Application ID + portal URL mapping  
- Invite to your server  
- Choosing where the Activity origin runs (Render/tunnel) and setting secrets there  

Paste the Application ID and preferred host when ready and the Activity origin can be wired to match.
