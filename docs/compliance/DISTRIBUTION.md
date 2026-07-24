<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# inPMS distribution and hosted-service controls

## Distribution surfaces

Review each applicable surface before release:

- source repository and GitHub source archives;
- release archives and on-premise installation bundles;
- Docker images and deployment archives;
- workspace packages or standalone gateway packages;
- generated frontend bundles and API deployment bundles; and
- the hosted inHotel service.

Every distributed source or binary bundle must expose or package the applicable
`LICENSE`, `NOTICE`, and third-party attribution materials. Container and archive
builds must be checked explicitly; a hosted-only deployment does not by itself
trigger Apache-2.0 source-publication obligations for server modifications, but
it remains subject to the terms of the services and assets actually used.

Hosting, commercial, privacy, data-processing, and support terms are separate
inHotel service decisions. This repository does not grant rights or make
warranties, indemnities, patent promises, or endorsement claims on behalf of
Telivity or another upstream contributor.

Before introducing a dependency, integration SDK, font, icon, image, model,
dataset, prompt asset, or derived artifact with non-standard or restrictive
terms, record its source, exact version, license, attribution requirements,
distribution status, and maintainer approval in the release record.
