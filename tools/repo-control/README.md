# Telivity Repository Control

Two ways to read the same snapshot board:

| Surface | Who | Access |
|---------|-----|--------|
| **Discord Activity** (voice channel) | Team in Discord | View-only inside Discord |
| **Hosted web (Clerk)** | Contributors | Free email sign-up / sign-in, view-only report |

The HTTP service is the Activity origin **and** the Clerk-gated web app. Contributors do not need Discord; Discord users do not need Clerk.

## Auth model

- **Contributors (Clerk):** any signed-in user can **read** the report. Mutations (refresh / annotations) stay off unless their email/user id is in `REPO_CONTROL_OWNER_EMAILS` / `REPO_CONTROL_OWNER_USER_IDS`.
- **Discord Activity:** view-only via Discord’s iframe proxy (`REPO_CONTROL_DISCORD_PUBLIC_READ=true`, requests detected from `discordsays.com`).
- **Owner token (optional):** `REPO_CONTROL_AUTH_TOKEN` for operator refresh without Clerk owner allowlist.

Never commit secrets.

## Required secrets (host / Cursor env)

```bash
# Set in host env / Cursor secrets / Render dashboard — NEVER commit values.
# Clerk (contributor web access)
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
# optional owners who can refresh:
# REPO_CONTROL_OWNER_EMAILS=

# Discord Activity
DISCORD_CLIENT_ID=
REPO_CONTROL_DISCORD_PUBLIC_READ=true

# optional operator token
# REPO_CONTROL_AUTH_TOKEN=
```

Create a free Clerk application at [dashboard.clerk.com](https://dashboard.clerk.com) (email sign-up enabled). Add your hosted URL to Clerk allowed origins / redirect URLs.

## Local

```bash
cd tools/repo-control
pnpm install --ignore-workspace
pnpm exec tsx src/analyze.ts --skip-checks
pnpm build:ui
# export Clerk + Discord env vars, then:
pnpm serve
```

## Discord install

See [docs/DISCORD_ACTIVITY.md](./docs/DISCORD_ACTIVITY.md). Needs your Application ID + portal URL mapping + invite.

## Hosted deploy

`render.yaml` is the Activity origin + Clerk web host. Set Clerk + Discord secrets in the host dashboard (`sync: false`). Do not use the public HAIP demo blueprint.

## Analyze / reuse

```bash
pnpm exec tsx src/analyze.ts
# other repos: REPO_CONTROL_CONFIG=config.example.yaml
```

No health score. Facts / heuristics / inferences are labeled. Runtime stays **Not connected** unless wired.
