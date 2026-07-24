<!-- Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance. -->
# Runtime and bundled asset inventory

The current source repository references the following external runtime and
presentation assets. Confirm exact image digests, current provider terms, and
redistribution rights for each release.

| Asset class | Current references | Distribution treatment |
| --- | --- | --- |
| Node base images | `node:20-alpine` in API and mock/gateway Dockerfiles | Docker image provenance and base-image terms must be reviewed at build time. |
| Databases and cache | `postgres:16-alpine`, `redis:7-alpine` | Deployment dependencies; not bundled into source releases. |
| Identity | `quay.io/keycloak/keycloak:24.0`, `keycloak-js` | Review Keycloak and JS package notices for the selected versions. |
| Object storage | `minio/minio:latest` in the development compose stack | Development dependency; pin and review before production distribution. |
| Fonts | Montserrat served from Google Fonts in public HTML | Review Google Fonts and font-license terms for hosted and bundled deployments. |
| Demo images | Unsplash URLs in the dashboard booking preview | Remote demo references only; do not package copies without verifying source terms. |
| AI assets | Separate model references and private build artifacts | No model weights are committed or redistributed; see `THIRD_PARTY_LICENSES`. |

Run the repository auditor and inspect the release bundle in addition to this
inventory. The inventory is a release control, not a blanket permission to
redistribute any listed external asset.
