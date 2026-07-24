<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# inPMS Licensing and Branding Design

## Goal

Align the fork with inHotel's identity and mission while preserving the upstream Apache-2.0 licensing obligations and making future source, dependency, model, and release audits repeatable.

## Approved decisions

- Use `inPMS` as the human-facing product name.
- Use `inHotel Sàrl` as the copyright holder for original inHotel modifications.
- Use `@inhotel-io/*` as the workspace/package namespace.
- Keep the complete upstream Apache-2.0 `LICENSE` unchanged.
- Keep explicit attribution to the upstream `TelivityAI/haip` project.
- Retain HAIP/Telivity references only for provenance, attribution, or unavoidable technical history.

## Scope

### Provenance and licensing

- Add a root `NOTICE` describing the upstream origin, inHotel modifications, copyright holders, and non-endorsement relationship.
- Add modification notices to materially changed upstream source, documentation, configuration, and metadata files where the file format supports them.
- Document upstream-derived, inHotel-authored, generated, and third-party content boundaries.
- Keep repository metadata and release artifacts labeled Apache-2.0.

### Branding and package identity

- Update the GitHub-facing description, README, badges, links, examples, documentation, project instructions, and package descriptions to describe inPMS and inHotel.
- Rename the root package and workspace package scopes from `haip`/`@telivityhaip/*` to `@inhotel-io/inpms`/`@inhotel-io/*`.
- Preserve technical compatibility only where required by the repository's build and test graph; user-facing branding must not continue to present the fork as HAIP.

### Third-party and AI licensing

- Retain and correct `THIRD_PARTY_LICENSES`.
- Inventory dependencies, base images, bundled assets, AI models, model weights, datasets, and generated artifacts.
- Add a machine-readable or CI-verifiable license audit for repository dependencies and attribution files.

### Release and contribution controls

- Add contribution guidance for Apache-2.0 compatibility and provenance.
- Add a release checklist covering LICENSE, NOTICE, third-party attributions, model terms, and distribution bundles.
- Add automated checks for stale branding, missing required legal files, and incomplete distribution metadata.

## Non-goals

- Do not invent new hotel-domain behavior.
- Do not redistribute AI model weights that are not already part of the repository's distribution model.
- Do not replace Apache-2.0 with a proprietary or incompatible license.
- Do not remove upstream attribution or imply Telivity endorsement.
- Do not introduce unrelated refactors.

## Verification

- Run the licensing audit against the complete repository tree.
- Run the stale-branding audit and review intentional provenance matches.
- Run formatting, lint, typecheck, build, and tests using the repository's documented commands.
- Verify that package/workspace renaming leaves no broken imports, scripts, lockfile references, or generated metadata.
- Verify that the final source and release surfaces contain LICENSE and NOTICE/attribution materials.
