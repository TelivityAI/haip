# Rewrite: Issues #97–#101 (orchestration)

**Scope:** HAIP’s **12 specialist agents** + **Revenue Manager (RManager)** + **OTAIP** (Connect / lodging agents).  
**Out of scope:** Remy / LLM premium addon — do not mention or depend on it here.

Paste each section into the corresponding GitHub issue (title + body). Close nothing until the AC is met.

---

## Agent model (source of truth)

| Layer | What |
|-------|------|
| **12 specialists** | `demand_forecast`, `pricing`, `overbooking`, `channel_mix`, `group_pickup`, `night_audit`, `housekeeping`, `cancellation`, `guest_comms`, `review_response`, `ar_collections`, `deposit_risk` |
| **RManager** | Meta-agent `revenue_manager` — runs revenue levers in dependency order and reconciles into one strategy (already shipped; deepen, don’t replace) |
| **OTAIP** | External agent orchestration (air + Domain 4 lodging). Talks to HAIP only via **Connect API** (`/api/v1/connect/*`). Option B: PMS stays standalone |

Do **not** build a second generic “pipeline engine” that duplicates OTAIP’s orchestrator or bypasses RManager.

---

## Issue #97

**Title:** Formalize the HAIP agent dependency graph (12 agents + RManager)

**Body:**

```markdown
## Goal

Make the **existing** agent graph explicit and enforceable — not a greenfield BRIEF-020 pipeline engine.

HAIP already has:
- 12 specialist agents (deterministic / calibrated)
- **RManager** as the in-product revenue orchestrator (demand → pricing / overbooking / channel_mix / group_pickup → one strategy)
- **OTAIP** for external multi-agent pipelines over Connect

This issue is about documenting + encoding that graph in HAIP so schedules, context, API, and tests all share one model.

## In scope

- Document the dependency graph:
  - **Revenue subgraph (RManager-owned):** `demand_forecast` → (`pricing`, `overbooking`, `channel_mix`, `group_pickup`) → `revenue_manager` synthesis
  - **Ops subgraph:** `night_audit`, `housekeeping`, `cancellation` (and how they relate to events / daily ops)
  - **Guest / commercial subgraph:** `guest_comms`, `review_response`, `ar_collections`, `deposit_risk`
- Encode the graph in code (typed registry / constants next to `VALID_AGENT_TYPES`) so RManager and future callers don’t hardcode ad-hoc lists in three places
- Clarify boundary: **OTAIP orchestrates OTAIP agents**; HAIP orchestrates HAIP agents (RManager + schedules). No embedded OTAIP runtime inside HAIP

## Out of scope

- Remy / LLM explanations
- Replacing RManager with a generic DAG runner
- `agent_pipelines` / `agent_pipeline_runs` tables unless a later issue proves they are still needed after this model

## Acceptance

- [ ] Single source-of-truth graph module (or schema comment + TS const) listing the 12 + RManager edges
- [ ] RManager imports that graph (or is proven equivalent) for lever order
- [ ] Short doc section in README or `docs/` describing 12 agents / RManager / OTAIP Connect boundary
- [ ] No second orchestration runtime introduced
```

---

## Issue #98

**Title:** Default schedules + event triggers for the 12 agents and RManager

**Body:**

```markdown
## Goal

Wire **schedules and event triggers** to the formalized agent graph (#97) so the 12 specialists + RManager run on sensible cadences — without inventing a parallel pipeline product.

## Defaults (starting point; adjust with evidence)

| Trigger | Agents |
|---------|--------|
| Every ~4h (or property config) | `revenue_manager` (pulls demand + levers) |
| Daily ops window | `housekeeping`, `cancellation`, `ar_collections` as configured |
| Night-audit / close event | `night_audit` |
| Reservation / guest lifecycle events | `guest_comms` (existing listeners stay authoritative) |
| Review ingested | `review_response` |
| Manual / on-demand | Any specialist + RManager via existing `POST .../agents/.../run` |

## In scope

- Align per-agent `runScheduleCron` (and any BullMQ / cron entrypoints) with the graph
- Prefer **RManager’s schedule** as the revenue cadence; avoid double-running demand/pricing on conflicting crons unless intentionally independent
- Event → agent mapping documented and tested for night audit + guest-comms paths already in tree
- Property-level enable/disable remains on `agent_configs`

## Out of scope

- Remy
- OTAIP-internal pipeline schedules (owned by OTAIP)
- Generic multi-pipeline CRUD UI

## Acceptance

- [ ] Documented default cron/event matrix for all 12 + RManager
- [ ] Config/schedule path does not fight RManager (no silent duplicate revenue runs)
- [ ] Tests for at least one schedule path and one event path
```

---

## Issue #99

**Title:** Agent graph API + RManager run visibility on the Revenue dashboard

**Body:**

```markdown
## Goal

Expose the **12 + RManager** graph and recent orchestration runs to operators — not a generic pipeline designer.

## In scope

- Read APIs (extend existing agent controller as needed):
  - Graph: nodes (12 + RManager) + edges from #97
  - RManager (and specialist) recent runs / decisions for a `propertyId`
- Dashboard (Revenue / Agents area):
  - Graph view of revenue subgraph (demand → levers → RManager)
  - Run history for RManager with links into existing decision detail
- Keep multi-tenant: every query requires `propertyId`

## OTAIP

- Optional read-only note/link: lodging traffic enters via Connect — do not build an OTAIP pipeline visualizer inside HAIP

## Out of scope

- Remy
- Pipeline CRUD / drag-drop builder
- WebSocket live DAG unless cheap on top of existing patterns

## Acceptance

- [ ] Graph endpoint (or embedded in list-agents) returns 12 + RManager + edges
- [ ] Revenue UI shows graph + RManager recent runs for the selected property
- [ ] Swagger on new/changed routes; propertyId enforced
```

---

## Issue #100

**Title:** Cross-agent context for the 12 specialists (RManager + OTAIP boundary)

**Body:**

```markdown
## Goal

Standardize how HAIP agents pass context so RManager (and any sequential specialist runs) share **upstream results** without ad-hoc coupling — and define what OTAIP may pass in via Connect.

## In scope

### HAIP internal

- Extend `AgentContext` with optional structured fields, e.g.:
  - `upstreamResults?: Record<agentType, unknown>` (or typed slices)
  - Keep `triggeredBy` / `eventPayload`
- RManager populates upstream demand (and lever summaries) in a form other code can reuse
- Document the revenue data flow: `demand_forecast` → `pricing` / `overbooking` / `channel_mix` / `group_pickup` → RManager synthesis
- Ops/guest agents: eventPayload conventions only where they already run on events

### OTAIP boundary

- Connect API remains credential-scoped; no propertyId confused-deputy paths
- Document which Connect operations OTAIP lodging agents use; HAIP does not import OTAIP’s orchestrator types
- If cross-system correlation IDs are needed, add a single optional request header/field — keep it minimal

## Out of scope

- Remy / LLM prompts
- Replacing specialist `analyze()` contracts wholesale
- Embedding OTAIP pipeline validator in HAIP

## Acceptance

- [ ] `AgentContext` (or adjacent DTO) supports upstream results with types/tests
- [ ] RManager uses the shared shape (migrate off one-off signal bags where practical)
- [ ] Short boundary note: HAIP graph vs OTAIP Connect
```

---

## Issue #101

**Title:** Tests + performance metrics for the 12 agents and RManager

**Body:**

```markdown
## Goal

Harden orchestration of the **12 specialists + RManager** with tests and operator-facing performance metrics. No Remy / LLM metrics here.

## In scope

- Tests:
  - RManager dependency order + best-effort lever failures (one lever fails ≠ whole run aborts)
  - Graph registry matches RManager’s lever set (#97)
  - Schedule/event wiring smoke from #98 where applicable
  - Multi-tenant: agent runs/decisions always scoped by `propertyId`
- Metrics (from existing `agent_decisions` / training snapshots where possible):
  - Per-agent: runs, approve/reject, confidence distribution, outcome accuracy when recorded
  - RManager: lever participation, conflict counts, horizon coverage
- Dashboard: performance tab (or section) for selected property — specialists + RManager only

## Out of scope

- Remy token/latency/cost metrics
- OTAIP pipeline validator metrics (live in OTAIP)
- Self-modifying “auto-tune production rates” without human approval

## Acceptance

- [ ] Meaningful new/extended Vitest coverage on RManager + graph
- [ ] Performance API (or extend existing `getPerformance`) covers the 12 + RManager
- [ ] Dashboard surfaces the metrics for one property
- [ ] README / test counts updated if required by CI
```

---

## Suggested labels / epic note

Treat as epic **“HAIP agent orchestration (12 + RManager + OTAIP boundary)”**.  
Supersedes the old BRIEF-020 “generic pipeline engine” wording on these five issues.
