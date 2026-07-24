# Go live — Yotpo

## Demo
```bash
./integrations/demos/run.sh yotpo
```

Console review source until partner credentials exist.

## Live
1. Complete vendor partner access for Yotpo.
2. Replace the named console review provider with a real HTTP client (`source`: `yotpo`).
3. Configure vendor keys; pull via `POST /api/v1/reviews/pull`.

Docs: docs/integrations/wave3-reviews.md
