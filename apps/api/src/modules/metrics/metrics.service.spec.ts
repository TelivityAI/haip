import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders Prometheus HTTP, booking, channel, audit, and webhook signals', () => {
    const metrics = new MetricsService();
    metrics.observeHttp('POST', '/api/v1/booking-engine/book', 201, 0.25);
    metrics.observeHttp('POST', '/api/v1/connect/book', 500, 0.5);
    metrics.onChannelSyncCompleted({} as any);
    metrics.onChannelSyncFailed({} as any);
    metrics.onAuditCompleted({ data: { businessDate: '2026-09-06', errors: [] } } as any);
    metrics.onWebhookDeliveryFailed({} as any);

    const output = metrics.render();
    expect(output).toContain('haip_http_requests_total');
    expect(output).toContain('haip_booking_create_total{outcome="success"} 1');
    expect(output).toContain('haip_booking_create_total{outcome="failed"} 1');
    expect(output).toContain('haip_channel_sync_total{outcome="success"} 1');
    expect(output).toContain('haip_channel_sync_total{outcome="failed"} 1');
    expect(output).toContain('haip_night_audit_runs_total{outcome="success"} 1');
    expect(output).toContain('haip_webhook_delivery_failures_total 1');
    expect(output).not.toContain('property_id=');
  });

  it('mounts the scrape action as an explicitly public endpoint', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MetricsController.prototype.scrape)).toBe(true);
    const controller = new MetricsController(new MetricsService());
    expect(controller.scrape()).toContain('# TYPE haip_http_requests_total counter');
  });
});
