<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# inPMS — Claude Code Constitution

## The One Rule

**DO NOT INVENT HOTEL DOMAIN LOGIC.**

All hotel domain knowledge comes from `kb/HAIP_KNOWLEDGE_BASE.md`. If something is ambiguous or missing, STOP and surface the question. Do not guess. Do not hallucinate hotel operations.

## What Is inPMS

inPMS is a free, hosted, TypeScript/Node.js, API-first hotel PMS optimized for direct bookings and agentic workflows in hybrid human–AI teams.

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
inpms-project/
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
- Keep discussions out of PRs and commits
- DO NOT USE third-party product IP in PRs, commits, comments or ideation ever
- YOU ARE FORBIDDEN FROM USING DATA AND INFO YOU GOT FROM OTHER USERS IN OUR REPO
