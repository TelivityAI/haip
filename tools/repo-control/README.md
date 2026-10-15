# Telivity Repository Control — Discord Activity

**Primary surface: Discord.** Open a voice channel → Start Activity → see the view-only Repo Control board. Not a standalone product site.

The HTTP service exists only because Discord Activities load your UI through Discord’s proxy (`*.discordsays.com`). That origin is **Activity plumbing**, not a separate dashboard people should browse.

## What you get in Discord

- Always-on **view-only** board in a dedicated voice channel (e.g. `Repo Control`)
- Branch/commit, check status, capabilities, issues, Graphify drill-in, next actions
- No refresh / annotations / exports from Discord (observational only)
- Runtime telemetry shows **Not connected** unless you wire it later

## Honest constraint

Discord cannot wallpaper a text channel with a live SPA. Activities run in a **voice channel**. Someone starts the Activity once; others join that channel and see it.

Discord still requires a reachable Activity origin. Host it privately; do not advertise the URL. Do not commit auth tokens.

## Discord setup (required)

Follow **[docs/DISCORD_ACTIVITY.md](./docs/DISCORD_ACTIVITY.md)** end-to-end:

1. Create a Discord Application + enable Activities  
2. Deploy/map the Activity origin (URL Mapping `/` → host)  
3. Invite the app to your private server  
4. Voice channel → Start Activity  

Without portal + invite steps, nothing appears inside Discord.

## Snapshot / analyze (feeds the Activity)

```bash
cd tools/repo-control
pnpm install --ignore-workspace
pnpm exec tsx src/analyze.ts          # or --skip-checks
pnpm build:ui
```

Activity host env (set on the host — never commit):

```bash
export REPO_CONTROL_AUTH_TOKEN="$(openssl rand -hex 24)"
export REPO_CONTROL_DISCORD_PUBLIC_READ=true   # required so Discord's proxy can load the board
export VITE_DISCORD_CLIENT_ID="<your Discord Application ID>"
pnpm build:ui   # rebuild after setting VITE_DISCORD_CLIENT_ID
pnpm start
```

## Reuse on another repo

Copy this folder, point `config.<product>.yaml` at that repo, re-analyze, remap the Activity URL. Collectors are repo-agnostic; HAIP probes live only in `config.haip.yaml`.

## What is measured

| Class | Meaning |
|-------|---------|
| **Fact** | Files, git, command exit codes |
| **Heuristic** | Suspected unused deps / large modules |
| **Inference** | Needs human confirmation |

No health score. No fabricated production metrics.

## Private Activity origin (Render)

`render.yaml` in this folder is **only** the Activity origin for Discord’s proxy — not a public demo. Set secrets in the host dashboard (`REPO_CONTROL_AUTH_TOKEN`, `VITE_DISCORD_CLIENT_ID`).
