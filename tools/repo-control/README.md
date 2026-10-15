# Telivity Repository Control

Private, reusable **Repository Control Dashboard** for honest codebase status — not a decorative health score.

- Isolated under `tools/repo-control` (does not modify customer HAIP apps)
- Snapshot pipeline → versioned `schema/snapshot.v1.json`
- Dense desktop overview (1440×900 target)
- Graphify map drill-in
- Optional **Discord Activity** (view-only) + private authenticated browser URL

## What is measured vs inferred

| Class | Meaning |
|-------|---------|
| **Fact** | Taken from files, git, or command exit codes |
| **Heuristic** | Pattern-based (large files, unused-dep string scan) — labeled **suspected** |
| **Inference** | Requires human confirmation |

**Verified** capability status is **not** assigned merely because a route, function, UI page, or unit test exists. This scanner defaults to **implemented, unverified** when code+tests are located without a passing capability-specific workflow.

**Runtime telemetry** shows **Not connected** unless you wire external systems (not included by default). No uptime, users, revenue, or production errors are fabricated.

## Quick start (local)

```bash
cd tools/repo-control
pnpm install --ignore-workspace   # isolated from the HAIP pnpm workspace

# Fast snapshot (structure/git/capabilities/todos/bloat; checks disabled via flag)
pnpm analyze -- --skip-checks

# Or full configured checks (lint/typecheck per config.haip.yaml)
pnpm analyze

pnpm build:ui
REPO_CONTROL_AUTH_TOKEN=dev pnpm serve
# → http://localhost:8787
```

Login with token `dev`. Refresh re-runs analysis (authenticated).

### Discord view-only preview

```bash
REPO_CONTROL_AUTH_TOKEN=dev REPO_CONTROL_DISCORD_PUBLIC_READ=true pnpm serve
# open http://localhost:8787/?discord=1
```

Portal setup: [docs/DISCORD_ACTIVITY.md](./docs/DISCORD_ACTIVITY.md).

## Reuse on another repo

1. Copy `tools/repo-control` (or depend on it as a private package).
2. Copy `config.example.yaml` → `config.<product>.yaml`.
3. Point `repoRoot`, `checks`, and `capabilities` probes at that repository.
4. Run `REPO_CONTROL_CONFIG=config.<product>.yaml pnpm analyze`.

No HAIP modules are hardcoded in collectors — only in `config.haip.yaml`.

## Snapshots

- Written to `snapshots/latest.json` and stamped files
- Annotations in `annotations.json` (gitignored) — do **not** mutate scan evidence
- Graphify outputs under configured `graphifyDir` (default `tools/repo-control/graphify-out`)

## Private hosting

See `render.yaml` in this folder — **separate** from the public HAIP demo blueprint.

- Browser: auth token required
- Discord Activity: optional `REPO_CONTROL_DISCORD_PUBLIC_READ=true` for read-only proxy access
- Refresh on host: `POST /api/refresh` with auth (or upload a snapshot). Not live local FS.

**Do not publish publicly without explicit approval.**

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm analyze` | Run collectors → snapshot |
| `pnpm serve` / `pnpm start` | Serve UI + API |
| `pnpm build:ui` | Vite production build |
| `pnpm test` | Unit tests |

Analyze flags: `--config <path>`, `--skip-checks`, `--skip-graphify`.
