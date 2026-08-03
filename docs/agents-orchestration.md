# HAIP agent orchestration

HAIP hosts orchestration for its own agents. There is no generic pipeline engine.

## Layers

| Layer | Role |
|-------|------|
| **12 specialists** | Deterministic / calibrated agents (`demand_forecast`, `pricing`, `overbooking`, `channel_mix`, `group_pickup`, `night_audit`, `housekeeping`, `cancellation`, `guest_comms`, `review_response`, `ar_collections`, `deposit_risk`) |
| **RManager** (`revenue_manager`) | In-product revenue orchestrator: runs demand → levers → one strategy |
| **OTAIP** | External multi-agent orchestration (air + lodging). Talks to HAIP only via **Connect API** (`/api/v1/connect/*`). Option B: PMS stays standalone |

## Revenue data flow

```
demand_forecast → (pricing | overbooking | channel_mix | group_pickup) → revenue_manager
```

Source of truth in code: [`apps/api/src/modules/agent/agent-graph.ts`](../apps/api/src/modules/agent/agent-graph.ts).

Ops and guest/commercial agents run on their own schedules or events — they are not RManager levers.

## Boundary: HAIP vs OTAIP

- **HAIP** schedules and orchestrates HAIP agents (RManager + external cron + event listeners).
- **OTAIP** orchestrates OTAIP agents; lodging traffic enters HAIP through Connect credentials.
- HAIP does not import OTAIP orchestrator types or embed an OTAIP runtime.

## Schedules

`runScheduleCron` defaults live on each agent’s `getDefaultConfig()`. Revenue levers intentionally have **no** independent cron so they do not double-run against RManager. Hosted deployments fire agents with [`scripts/cron/agent-runs.sh`](../scripts/cron/agent-runs.sh) — see [`docs/operations/cron.md`](./operations/cron.md).

## API

- `GET /api/v1/agents/:propertyId/graph` — nodes + edges + status
- `GET /api/v1/agents/:propertyId/orchestration-performance` — per-agent metrics + RManager summary
- `POST /api/v1/agents/:propertyId/:agentType/run?triggeredBy=schedule|manual` — run (default manual)
