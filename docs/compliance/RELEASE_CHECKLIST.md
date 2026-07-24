<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# inPMS Release Compliance Checklist

Complete this checklist for every source, container, binary, package, or
on-premise release.

## Provenance and licensing

- [ ] `LICENSE` contains the complete Apache License, Version 2.0 text.
- [ ] `NOTICE` identifies TelivityAI/haip as upstream and inHotel Sàrl as the
      modifier.
- [ ] Upstream copyright, attribution, patent, and trademark notices are
      retained where applicable.
- [ ] Materially modified upstream files carry modification notices where the
      format supports them.
- [ ] The release does not imply Telivity ownership, maintenance, endorsement,
      or affiliation.

## Third-party and AI assets

- [ ] Review [`DEPENDENCY_REVIEW.md`](DEPENDENCY_REVIEW.md) and the generated
      dependency/license report.
- [ ] Review [`ASSET_INVENTORY.md`](ASSET_INVENTORY.md) against the actual
      container, archive, package, and hosted-service contents.
- [ ] Dependency license metadata has been generated and reviewed.
- [ ] Docker base images, fonts, icons, images, SDKs, integrations, and other
      bundled assets have documented provenance.
- [ ] `THIRD_PARTY_LICENSES` matches the artifacts actually distributed.
- [ ] AI model, model-weight, dataset, and derived-artifact terms have been
      verified for this release.
- [ ] No model weights or restricted artifacts are redistributed without an
      explicit approval and complete attribution package.

## Distribution surfaces

- [ ] Source archives include `LICENSE`, `NOTICE`, and third-party attribution.
- [ ] Container images and deployment archives expose or package the same files.
- [ ] Published packages include the applicable legal files in their package
      contents.
- [ ] Hosted-only deployments have been distinguished from distributed
      artifacts; separate hosting, privacy, data-processing, and support terms
      are reviewed where applicable.

## Verification

- [ ] `pnpm audit:compliance` passes.
- [ ] `pnpm lint` passes with no new errors.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes or documented service-dependent exceptions are approved.
- [ ] Final release metadata uses the inPMS/inHotel identity.
