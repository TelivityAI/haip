<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# Contributing to inPMS

Thank you for contributing to inPMS, the inHotel project for hospitality
operators. Contributions must preserve the project's provenance and licensing
requirements.

## Licensing and provenance

- The repository and inHotel modifications use Apache-2.0 unless a separate
  written decision states otherwise.
- Do not remove or alter the upstream `LICENSE` file, `NOTICE`, or required
  third-party attribution.
- Identify copied or adapted code, documentation, assets, models, and examples
  and include their source and license before submitting a change.
- Add a modification notice to materially changed upstream files where the
  file format supports one.
- Do not add model weights, datasets, or generated artifacts without verifying
  their exact license, redistribution rights, and attribution requirements.
- Contributions must not imply that the upstream author endorses or maintains inPMS.

By intentionally submitting a contribution for inclusion in this repository,
you agree that it may be distributed under the repository's Apache-2.0 terms,
unless you have a separate written agreement with inHotel Sàrl.

## Before opening a pull request

1. Run `pnpm install --frozen-lockfile`.
2. Run `pnpm audit:compliance`.
3. Run `pnpm lint`, `pnpm typecheck`, and the relevant tests.
4. Check that `LICENSE`, `NOTICE`, and `THIRD_PARTY_LICENSES` remain present.
5. Describe any new third-party dependency or distributable asset and its
   license in the pull request.
