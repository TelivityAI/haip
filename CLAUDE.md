# HAIP — Claude Code Constitution

## The One Rule

**DO NOT INVENT HOTEL DOMAIN LOGIC.**

All hotel domain knowledge comes from `kb/HAIP_KNOWLEDGE_BASE.md`. If something is ambiguous or missing, STOP and surface the question. Do not guess. Do not hallucinate hotel operations.

## Public artifacts — non-negotiable (legal)

These rules apply to **every** PR title/body, commit message, code comment, doc,
issue, and other artifact that can leave the private chat:

1. **Chat stays in chat.** Never paste private discussion, Discord/Slack quotes,
   legal fears, “someone said…”, negotiation context, or internal debate into a
   PR, commit, or public doc. PRs describe *what changed in the code*, not the
   conversation that led there.
2. **No third-party IP in public text.** Never name or allude to competitor /
   third-party PMS products, vendors, or their proprietary models, APIs, or
   “patterns” in PR titles/bodies, commits, code comments, or shipped docs
   unless that name is already required as a literal integration identifier
   that already exists in-repo (e.g. an adapter slug the product must call).
   Describe HAIP’s own model in HAIP’s own words (booking wrapper, per-room
   reservation, etc.). Do **not** write “follows X/Y pattern” or attribute
   design to another company’s product.
3. If domain research used external vendors privately, keep that in `kb/` /
   research notes — **never** promote those names into PR copy or new comments.

## What Is HAIP

HAIP (Hotel AI Platform) is an open-source, TypeScript/Node.js, API-first hotel PMS. Sister project to OTAIP. HAIP handles lodging. OTAIP handles air.

Architecture: Option B — PMS is standalone, OTAIP agents connect via API (not embedded).

## Tech Stack (match exactly)

- TypeScript strict mode, Node.js >=20
- NestJS framework
- PostgreSQL (multi-tenant, property_id on every table)
- Drizzle ORM (TypeScript-native, no magic)
- Redis + BullMQ (cache, queue, pub/sub)
- REST API, OpenAPI 3.0 auto-generated from NestJS decorators
- OAuth 2.0 / OpenID Connect
- pnpm workspaces
- Vitest for testing
- tsup for building packages
- Docker + docker-compose

## Code Standards

- All API endpoints go through NestJS controllers with Swagger decorators
- Every table has `property_id` for multi-tenancy
- Never store raw card data (PCI DSS — use Stripe/Adyen tokenization)
- Audit log all data modifications (GDPR compliance)
- Use Drizzle ORM for all database queries — no raw SQL except migrations
- Tests required for all business logic
- Use the webhook event pattern: entity.action (e.g., reservation.created)

## Multi-tenancy enforcement (non-negotiable)

Every service method that queries a table with `propertyId` MUST filter by it
alongside any id filter. This applies to reads, updates, and deletes — even
for methods called only internally, because future controllers may call them.

- `WHERE id = $1` on a property-scoped table is a BUG. Use
  `and(eq(table.id, id), eq(table.propertyId, propertyId))`.
- Controllers: `propertyId` is a REQUIRED query param (UUID-validated) on every
  `:id` route, not optional. List endpoints also require it.
- `propertyId` must come from the request, never inferred from other entity
  lookups (that creates a confused-deputy bug — the attacker supplies the id,
  the server derives a matching propertyId, scoping becomes a no-op).
- Exceptions — document the reason in a code comment when you deviate:
  - `guests` table: the ROW is cross-property by design (one person stays at
    multiple hotels), but API access MUST verify a reservation link at the
    requesting property — i.e. scope reads/updates/deletes by "has this guest
    at least one reservation at `propertyId`?". Creation is the only exception
    (walk-ins have no reservation yet); the linking reservation is created
    immediately after.
  - `properties` table: the property IS the tenant
  - Connect API (`/api/v1/connect/*`): bearer-credential model via
    `confirmationNumber` — scoped by credential possession, not propertyId
  - Internal cron/webhook receivers invoked with trusted server-side ids

When adding a new controller route or service method that touches a
property-scoped table, the WHERE clause is the first thing to verify.

## Project Structure

```
haip-project/
├── apps/api/              # NestJS API application
├── packages/database/     # Drizzle ORM schema and migrations
├── packages/shared/       # Shared types and utilities
├── kb/                    # Knowledge base (domain truth)
├── instructions/          # Project rules
├── specs/                 # Agent specs (YAML)
├── briefs/                # Claude Code build briefs
└── docker-compose.yml     # Local dev environment
```

## Module Pattern

Each domain module in `apps/api/src/modules/` follows:
```
module-name/
├── module-name.module.ts     # NestJS module definition
├── module-name.controller.ts # REST endpoints with Swagger
├── module-name.service.ts    # Business logic
└── dto/                      # Request/response DTOs
```

## Don'ts

- Don't add dependencies without justification
- Don't skip tests
- Don't commit research files (kb/research/raw/)
- Don't commit .env files
- Don't invent hotel domain concepts not in the KB
- Don't use raw SQL outside of migration files
- Don't store sensitive data unencrypted
- Don't put chat/Discord/Slack discussion into PRs or commits
- Don't name third-party / competitor product IP in PRs, commits, or new comments
