<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# Dependency and license review

The repository uses pnpm workspaces and records the resolved dependency graph in
`pnpm-lock.yaml`. Generate the current machine-readable dependency/license report
with:

```bash
pnpm audit:compliance:json
```

The report records each installed package's name, version, and declared npm
license metadata. It does not infer a license when package metadata is absent.
Those entries require maintainer review before redistribution.

The current audit found 2,653 installed package records, with two records for the
`pause@0.0.1` package lacking a declared license field. This may represent the
same package through multiple pnpm resolution paths; verify the package source and
license before the first release.

Dependency additions, SDKs, fonts, integrations, AI assets, and generated
artifacts with restrictive or non-standard terms require a recorded source,
version, license, attribution requirement, distribution status, and maintainer
approval. The release checklist is in
[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).
