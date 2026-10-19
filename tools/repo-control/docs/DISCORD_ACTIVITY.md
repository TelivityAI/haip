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

You (human) must do these — no agent can click your portal. **Inviting the bot alone is not enough**; Discord only lists apps flagged as Embedded Activities.

Application: **Haip Dashboard** (`1560400786767220806`)  
Activity origin: `telivity-repo-control-v2.onrender.com`

### A. Make it an Activity (required — this is why search shows “No activities match”)

1. Open https://discord.com/developers/applications → **Haip Dashboard**.
2. **OAuth2 → Redirects**: delete `https://127.0.0.1`. Add `https://telivity-repo-control-v2.onrender.com` and save. That localhost redirect is what Discord opens when the Activity fails to launch.
3. **Activities → URL Mappings**:
   - Prefix: `/`
   - Target: `telivity-repo-control-v2.onrender.com` (no `https://`)
   - Save
4. **Activities → Settings**:
   - Turn **Enable Activities** **ON**
   - Under **Supported Platforms**, check **Web**
   - Save
5. **Installation** (left sidebar):
   - Enable **Guild Install** and **User Install**
   - Save

The Entry Point command (`/launch`, type PRIMARY_ENTRY_POINT) is already registered on this app. If the portal still warns about it, ignore the warning after URL mapping + Enable Activities are correct.

### B. Discord client: show in-dev Activities

1. Discord → **User Settings** → **App Settings** → **Advanced** → turn **Developer Mode** **ON**.
2. Fully quit Discord and reopen (or refresh the browser client).

### C. Bot invite (already done if the bot is in Telivity Community)

Permissions integer `549756863504` (Manage Channels, View Channels, Connect, Use Embedded Activities):

https://discord.com/oauth2/authorize?client_id=1560400786767220806&permissions=549756863504&integration_type=0&scope=bot%20applications.commands

### D. Launch

1. Join any **voice** channel in **Telivity Community**.
2. Click the rocket / **Activities** / **Choose Activity**.
3. Your app should appear in the **developer** shelf as **Haip Dashboard** (even if the public search for published games finds nothing).
4. Click it and leave it running.

If it still doesn’t appear: confirm step A4 shows Enable Activities on, Desktop is checked, URL mapping `/` exists, and Developer Mode is on — then restart Discord.

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
- Repo map tile opens inside the Activity  
- Snapshot data from last analyze  

## Blockers only you can clear

- Discord Application ID + portal URL mapping  
- Invite to your server  
- Choosing where the Activity origin runs (Render/tunnel) and setting secrets there  

Paste the Application ID and preferred host when ready and the Activity origin can be wired to match.
