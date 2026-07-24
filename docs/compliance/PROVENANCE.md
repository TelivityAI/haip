<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# inPMS provenance and asset classification

## Fork point

The fork was created from upstream commit
`0a92c406d1e299d215ca038b9d2fd1f3f133ce59`, currently reachable as the upstream
`TelivityAI/haip` commit titled “feat: 58 integration demos (shipped + adapters)
with GO_LIVE checklists” and dated 2026-07-24. Verify this commit against the
upstream repository before the first public release.

## Ownership and classification

| Surface | Classification | Treatment |
| --- | --- | --- |
| `apps/`, `packages/`, `tools/`, integration and deployment files | Upstream-derived with inHotel modifications | Apache-2.0; retain upstream notices and add inHotel modification notices where the format permits. |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, prompts, package metadata, and public HTML | inHotel-maintained documentation/metadata derived from upstream | Use inPMS branding; retain only necessary origin, attribution, historical, or compatibility references. |
| `scripts/audit-inpms-compliance.*` and `scripts/ensure-modification-notices.mjs` | inHotel-authored compliance tooling | Apache-2.0 and maintained with the repository. |
| `dist/`, generated build output, lockfiles, and test artifacts | Generated | Recreate from source; do not treat generated output as independently authored source. |
| `node_modules/` and separately downloaded AI models | Third-party/external | Not committed; review their terms before redistribution. |

## Compatibility identifiers

Some `HAIP_*` environment variables, database/realm identifiers, CSS selectors,
legacy tool paths, and model references remain for deployment compatibility. The
compliance allowlist classifies these occurrences so they are not mistaken for
current product branding. New user-facing copy should use inPMS and inHotel.

## Review gate

Maintainers must confirm the fork point, source provenance, generated artifacts,
third-party notices, model terms, and the actual distribution contents before
publishing the first inPMS release.
