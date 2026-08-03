# Go live — Trustpilot

## Demo
```bash
./integrations/demos/run.sh trustpilot
```

Console review source until partner credentials exist.

## Live
1. Complete vendor partner access for Trustpilot.
2. Replace the named console review provider with a real HTTP client (`source`: `trustpilot`).
3. Configure vendor keys; pull via `POST /api/v1/reviews/pull`.

Docs: docs/integrations/wave3-reviews.md
