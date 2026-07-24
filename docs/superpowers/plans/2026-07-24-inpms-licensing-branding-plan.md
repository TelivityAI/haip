# inPMS Licensing and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the TelivityAI/haip fork into an inPMS/inHotel-branded repository with Apache-2.0 provenance, package namespace `@inhotel-io/*`, repeatable dependency/attribution audits, and release-ready legal documentation.

**Architecture:** Keep upstream-derived code under Apache-2.0, add a root NOTICE and inHotel modification notices, and separate user-facing rebranding from compatibility-sensitive runtime identifiers. Use a Node.js compliance auditor shared by local verification and CI; use repository metadata and documentation as the authoritative attribution surface.

**Tech Stack:** Node.js 20+, pnpm 9, TypeScript/NestJS workspace, Node `node:test`, GitHub Actions, Markdown/JSON/YAML configuration.

## Global Constraints

- Copyright holder for inHotel modifications: `inHotel Sàrl`.
- Human-facing product name: `inPMS`.
- Workspace/package namespace: `@inhotel-io/*`.
- Preserve the complete upstream Apache-2.0 `LICENSE` text and `Copyright 2026 Telivity` notice.
- Preserve explicit origin attribution to `TelivityAI/haip`.
- Do not rename compatibility-sensitive environment variables, database credentials, Keycloak realms, or generated technical identifiers unless the change is required for package resolution.
- Do not redistribute AI model weights; keep model attribution accurate to the repository's actual distribution.
- Do not add unrelated hotel-domain behavior or dependencies without a concrete compliance need.

---

### Task 1: Establish the legal/provenance documentation

**Files:**
- Create: `NOTICE`
- Create: `CONTRIBUTING.md`
- Create: `docs/compliance/RELEASE_CHECKLIST.md`
- Modify: `THIRD_PARTY_LICENSES`
- Modify: `README.md`

**Interfaces:**
- Produces the authoritative upstream-origin, copyright, contribution, third-party, and release documentation used by later audit scripts and CI.

- [ ] **Step 1: Write the legal documentation fixtures/checks first**

Create the compliance test fixture expectations in `scripts/audit-inpms-compliance.test.mjs` for required text and files:

```js
assert.match(notice, /inHotel Sàrl/);
assert.match(notice, /TelivityAI\/haip/);
assert.match(notice, /Apache-2\.0/);
assert.match(license, /Copyright 2026 Telivity/);
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: FAIL because `NOTICE` and the audit implementation do not yet exist.

- [ ] **Step 3: Add `NOTICE`**

Use this content:

```text
inPMS is a modified fork of TelivityAI/haip.

Copyright 2026 Telivity for the upstream work.
Copyright 2026 inHotel Sàrl for inHotel modifications.

The upstream work and applicable derivative work are distributed under the
Apache License, Version 2.0. See LICENSE for the complete license text.

Upstream project: https://github.com/TelivityAI/haip
Fork project: https://github.com/inhotel-io/inpms

inPMS is maintained by inHotel Sàrl and is not presented as a Telivity product
or as endorsed by Telivity unless separately stated in writing.
```

- [ ] **Step 4: Add contribution and release policies**

Document Apache-2.0-compatible contributions, third-party provenance, required notices, no unapproved model-weight redistribution, and the release surfaces that must carry `LICENSE`, `NOTICE`, and third-party attribution material.

- [ ] **Step 5: Correct third-party attribution**

Rewrite `THIRD_PARTY_LICENSES` to say that no model weights are redistributed by this repository, distinguish training/distillation inputs from redistributed artifacts, retain the listed model attribution, and require verification of each model's exact license before any weights or derived artifacts are shipped.

- [ ] **Step 6: Add the README licensing section**

Add an “Upstream, attribution, and licensing” section linking to `LICENSE`, `NOTICE`, `THIRD_PARTY_LICENSES`, and `https://github.com/TelivityAI/haip`; state that inPMS is a modified fork maintained by inHotel Sàrl.

- [ ] **Step 7: Run the legal documentation checks**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: PASS for the legal-file fixtures.

- [ ] **Step 8: Commit if repository metadata permits**

Run: `git add NOTICE CONTRIBUTING.md docs/compliance/RELEASE_CHECKLIST.md THIRD_PARTY_LICENSES README.md scripts/audit-inpms-compliance.test.mjs && git commit -m "docs: establish inPMS licensing provenance"`

If `.git` remains read-only, preserve the changes and record the commit limitation in the final handoff.

### Task 2: Rename package metadata and workspace imports

**Files:**
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/booking/package.json`
- Modify: `apps/dashboard/package.json`
- Modify: `packages/database/package.json`
- Modify: `packages/shared/package.json`
- Modify: `tools/haip-connect-gpt/package.json`
- Modify: `tools/mock-bookingcom/package.json`
- Modify: `tools/mock-derbysoft/package.json`
- Modify: `tools/mock-siteminder/package.json`
- Modify: all source/config files importing `@telivityhaip/*`
- Modify: `pnpm-lock.yaml`
- Test: `scripts/audit-inpms-compliance.test.mjs`

**Interfaces:**
- Root package becomes `@inhotel-io/inpms`.
- Workspace package names use `@inhotel-io/<package>`.
- All workspace dependency and import references use the new namespace.

- [ ] **Step 1: Add failing namespace assertions**

Extend the compliance test:

```js
assert.equal(rootPackage.name, '@inhotel-io/inpms');
assert.equal(apiPackage.name, '@inhotel-io/api');
assert.equal(databasePackage.name, '@inhotel-io/database');
assert.equal(sharedPackage.name, '@inhotel-io/shared');
assert.doesNotMatch(allPackageJson, /@telivityhaip|"name":\s*"haip"/);
```

- [ ] **Step 2: Run the namespace test to verify it fails**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: FAIL with the existing `haip` and `@telivityhaip/*` metadata.

- [ ] **Step 3: Rename package manifests**

Apply this mapping consistently:

```text
haip                         -> @inhotel-io/inpms
@telivityhaip/api            -> @inhotel-io/api
@telivityhaip/booking        -> @inhotel-io/booking
@telivityhaip/dashboard      -> @inhotel-io/dashboard
@telivityhaip/database       -> @inhotel-io/database
@telivityhaip/shared         -> @inhotel-io/shared
@telivityhaip/haip-connect-gpt -> @inhotel-io/connect-gpt
@telivityhaip/mock-bookingcom -> @inhotel-io/mock-bookingcom
@telivityhaip/mock-derbysoft  -> @inhotel-io/mock-derbysoft
@telivityhaip/mock-siteminder -> @inhotel-io/mock-siteminder
```

Update descriptions, repository URLs, root scripts, Docker build filters, Vercel build commands, TypeScript imports, and all other package-resolution references. Keep unrelated `HAIP_*` environment variables and database/realm identifiers unchanged for compatibility.

- [ ] **Step 4: Regenerate the lockfile**

Run: `pnpm install --lockfile-only`

Expected: `pnpm-lock.yaml` contains the new workspace package names and no `@telivityhaip/` workspace references.

- [ ] **Step 5: Run focused package checks**

Run: `pnpm -r run typecheck` and `pnpm -r run build`.

Expected: all workspace packages resolve under `@inhotel-io/*`.

- [ ] **Step 6: Run namespace assertions**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: PASS for package names and workspace references.

- [ ] **Step 7: Commit if repository metadata permits**

Run: `git add package.json apps packages tools pnpm-lock.yaml && git commit -m "refactor: rename workspace packages for inPMS"`

### Task 3: Rebrand user-facing documentation and metadata

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Modify: `HAIP_BUILD_PLAN.md`
- Modify: `docs/**/*.md`
- Modify: `prompts/**/*.md`
- Modify: `apps/api/public/index.html`
- Modify: demo scripts and example environment files containing user-facing HAIP branding
- Modify: repository metadata through the GitHub API after local content is ready

**Interfaces:**
- User-facing documentation presents inPMS and inHotel.
- Required provenance references remain in `NOTICE`, README licensing section, changelog history, and upstream links.
- Compatibility identifiers such as `HAIP_ALLOW_INSECURE`, `HAIP_URL`, and database realm names are documented as legacy technical identifiers rather than silently changed.

- [ ] **Step 1: Add failing stale-branding assertions**

Extend the compliance test to scan user-facing files and reject product-branding lines containing `HAIP`, `Telivity`, or `telivityhaip` unless the file is an explicit provenance/legacy-compatibility allowlist entry.

- [ ] **Step 2: Run the stale-branding test to verify it fails**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: FAIL with the inherited README, instructions, changelog, docs, and HTML branding.

- [ ] **Step 3: Replace user-facing product copy**

Use the approved About copy in repository documentation:

```text
inPMS: a free, hosted PMS for hospitality operators, optimized for direct bookings and agentic workflows in hybrid human–AI teams.
```

Use `inPMS` for the product and `inHotel`/`inHotel Sàrl` for ownership and maintenance. Rewrite inherited Telivity marketing claims, upstream OTAIP positioning, and HAIP product claims so they describe the fork accurately.

- [ ] **Step 4: Preserve provenance and compatibility references**

Keep upstream links and historical changelog references where they document origin. Add an explicit allowlist with a reason for remaining technical identifiers such as environment variable names, Keycloak realms, database names, skill directory names, and legacy CLI paths.

- [ ] **Step 5: Add file modification notices**

For modified TypeScript/JavaScript/shell/CSS files, add a top comment:

```text
// Modified by inHotel Sàrl from the TelivityAI/haip upstream project; see NOTICE.
```

Use the equivalent HTML comment, Markdown comment, YAML comment, Dockerfile comment, or JSON metadata field for formats that support it. Do not alter generated output solely to add a notice.

- [ ] **Step 6: Run documentation and branding checks**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: PASS with only documented provenance and compatibility matches remaining.

- [ ] **Step 7: Commit if repository metadata permits**

Run: `git add README.md AGENTS.md CLAUDE.md CHANGELOG.md HAIP_BUILD_PLAN.md docs prompts apps integrations docker-compose*.yml && git commit -m "docs: rebrand fork as inPMS"`

### Task 4: Implement the compliance auditor and CI job

**Files:**
- Create: `scripts/audit-inpms-compliance.mjs`
- Modify: `package.json`
- Create: `.github/workflows/licensing-audit.yml`
- Create: `scripts/inpms-compliance-allowlist.json`
- Test: `scripts/audit-inpms-compliance.test.mjs`

**Interfaces:**
- CLI: `node scripts/audit-inpms-compliance.mjs [--root <path>] [--json <path>]`.
- Exit code `0`: all checks pass.
- Exit code `1`: required file, metadata, namespace, stale-branding, or attribution check fails.
- JSON output: `{ checkedFiles, packageNames, legacyMatches, dependencyLicenses, errors }`.

- [ ] **Step 1: Write unit tests for the auditor**

Cover these cases with temporary fixtures:

```js
test('passes a compliant repository fixture', async () => { /* ... */ });
test('fails when LICENSE or NOTICE is missing', async () => { /* ... */ });
test('fails when a workspace package retains @telivityhaip', async () => { /* ... */ });
test('fails on undocumented HAIP branding in user-facing files', async () => { /* ... */ });
test('allows upstream and compatibility matches listed in the allowlist', async () => { /* ... */ });
```

- [ ] **Step 2: Run the auditor tests to verify they fail**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: FAIL because the auditor and fixture behavior do not exist.

- [ ] **Step 3: Implement the minimal auditor**

Implement deterministic checks for:

1. Required `LICENSE`, `NOTICE`, and `THIRD_PARTY_LICENSES` files.
2. Apache-2.0 package metadata and `Copyright 2026 Telivity` preservation.
3. `inHotel Sàrl`, `TelivityAI/haip`, and Apache-2.0 presence in `NOTICE`.
4. Root/workspace package namespace and dependency-reference consistency.
5. User-facing stale-branding matches against the explicit allowlist.
6. Installed dependency package license metadata when `node_modules` exists, reporting missing licenses without guessing them.

- [ ] **Step 4: Run the auditor tests to verify they pass**

Run: `node --test scripts/audit-inpms-compliance.test.mjs`

Expected: PASS with all fixture cases.

- [ ] **Step 5: Add package scripts and CI**

Add:

```json
"audit:compliance": "node scripts/audit-inpms-compliance.mjs",
"audit:compliance:json": "node scripts/audit-inpms-compliance.mjs --json reports/inpms-compliance.json"
```

Create a GitHub Actions job that installs with `pnpm install --frozen-lockfile`, runs the auditor, uploads the JSON report, and runs the auditor tests.

- [ ] **Step 6: Run the full auditor locally**

Run: `pnpm audit:compliance`

Expected: exit `0` with no undocumented stale branding or missing legal files.

- [ ] **Step 7: Commit if repository metadata permits**

Run: `git add scripts package.json .github/workflows/licensing-audit.yml && git commit -m "ci: add licensing and branding audit"`

### Task 5: Verify dependency, model, and release surfaces

**Files:**
- Modify: `docs/compliance/RELEASE_CHECKLIST.md`
- Modify: `THIRD_PARTY_LICENSES`
- Modify: release Dockerfiles and package metadata only where required to expose legal files
- Test: `scripts/audit-inpms-compliance.test.mjs`

- [ ] **Step 1: Install the locked dependency graph**

Run: `pnpm install --frozen-lockfile`

Expected: installation completes without lockfile changes.

- [ ] **Step 2: Generate the dependency license inventory**

Run: `pnpm audit:compliance:json`

Expected: the JSON report lists installed packages and their declared license metadata; missing or non-standard licenses are surfaced for manual review.

- [ ] **Step 3: Inspect release surfaces**

Verify each Dockerfile, package `files` list, and release/archive script includes or exposes `LICENSE`, `NOTICE`, and required third-party attribution material. Keep model weights external unless separately approved and licensed.

- [ ] **Step 4: Run package validation**

Run: `pnpm lint && pnpm typecheck && pnpm build`

Expected: exit `0`; existing warnings are recorded but no new errors are introduced.

- [ ] **Step 5: Run tests**

Run: `pnpm test`

Expected: all existing tests and compliance tests pass; integration tests requiring unavailable services are reported separately with their exact prerequisite.

- [ ] **Step 6: Run final repository audits**

Run:

```bash
pnpm audit:compliance
rg -n -i 'HAIP|Telivity|telivityhaip' --glob '!LICENSE' --glob '!NOTICE' --glob '!THIRD_PARTY_LICENSES' --glob '!docs/superpowers/**'
git diff --check
```

Expected: only documented provenance/compatibility matches remain, and `git diff --check` is clean.

- [ ] **Step 7: Verify GitHub metadata**

Update the repository description to:

```text
inPMS: a free, hosted PMS for hospitality operators, optimized for direct bookings and agentic workflows in hybrid human–AI teams.
```

Verify the repository shows Apache-2.0 and links to the inPMS README and upstream attribution.

- [ ] **Step 8: Final handoff**

Report changed files, audit output, test/build results, remaining intentional legacy identifiers, any dependency license exceptions, and the inability to create a branch or commit if `.git` remains read-only.
