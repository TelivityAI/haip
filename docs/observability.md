# Production observability

HAIP exposes Prometheus text metrics at `GET /api/v1/metrics`. The endpoint is
public at the application layer so a Prometheus scraper does not need a hotel
staff JWT. **Restrict this path to the monitoring network at the reverse proxy
or firewall.** Do not expose it to the public internet.

Example Prometheus scrape job:

```yaml
scrape_configs:
  - job_name: haip-api
    metrics_path: /api/v1/metrics
    static_configs:
      - targets: ['haip-api:3000']
```

The first metrics surface includes:

- HTTP request count, 5xx count, and latency sum/count by method and stable route template
- booking-create success/failure counters for PMS, booking engine, and Connect routes
- channel sync success/failure counters
- night-audit outcome counters and last completed business date
- permanently failed webhook delivery count
- Node.js process uptime

Import [`ops/harden/grafana-haip-overview.json`](../ops/harden/grafana-haip-overview.json)
into Grafana and load [`ops/harden/prometheus-alerts.yml`](../ops/harden/prometheus-alerts.yml)
in Prometheus or a compatible rule engine.

## Label and privacy policy

Metrics use route templates such as `/reservations/:id`, never raw URLs. They do
not include guest ids, confirmation numbers, email addresses, payment ids, or
`property_id`. Adding a property label to every HTTP series creates both a
privacy concern and unbounded cardinality for large installations. Property
specific operational detail remains in the authenticated dashboard, staff
notifications, channel sync logs, and webhook delivery records.

## Queue depth

Webhook and migration BullMQ queues are currently created lazily inside their
services. A shared queue registry is required before a truthful process-wide
depth gauge can be exposed. Until then, alert on exhausted webhook deliveries
and migration job state rather than publishing a misleading zero-valued gauge.
