import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { WebhookPayload } from '../webhook/webhook.service';
import {
  WEBHOOK_DELIVERY_FAILED,
  type WebhookDeliveryFailedEvent,
} from '../webhook/webhook-delivery.service';

type HttpMetric = {
  count: number;
  errors: number;
  durationSeconds: number;
};

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

@Injectable()
export class MetricsService {
  private readonly http = new Map<string, HttpMetric>();
  private readonly bookingCreates = { success: 0, failed: 0 };
  private readonly channelSyncs = { success: 0, failed: 0 };
  private readonly nightAudits = { success: 0, failed: 0 };
  private webhookDeliveryFailures = 0;
  private lastAuditBusinessDate = 0;

  observeHttp(method: string, route: string, statusCode: number, durationSeconds: number) {
    const normalizedMethod = method.toUpperCase();
    const normalizedRoute = route || 'unmatched';
    const key = `${normalizedMethod}\u0000${normalizedRoute}\u0000${statusCode}`;
    const current = this.http.get(key) ?? { count: 0, errors: 0, durationSeconds: 0 };
    current.count += 1;
    current.errors += statusCode >= 500 ? 1 : 0;
    current.durationSeconds += Math.max(0, durationSeconds);
    this.http.set(key, current);

    if (
      normalizedMethod === 'POST'
      && /\/(booking-engine\/book|connect\/book|reservations)\/?$/.test(normalizedRoute)
    ) {
      this.bookingCreates[statusCode >= 200 && statusCode < 400 ? 'success' : 'failed'] += 1;
    }
  }

  @OnEvent('channel.sync_failed')
  onChannelSyncFailed(_payload: WebhookPayload) {
    this.channelSyncs.failed += 1;
  }

  @OnEvent('channel.sync_completed')
  onChannelSyncCompleted(_payload: WebhookPayload) {
    this.channelSyncs.success += 1;
  }

  @OnEvent('audit.completed')
  onAuditCompleted(payload: WebhookPayload) {
    const errors = Array.isArray(payload.data?.['errors']) ? payload.data['errors'] : [];
    this.nightAudits[errors.length > 0 ? 'failed' : 'success'] += 1;
    const businessDate = String(payload.data?.['businessDate'] ?? '');
    const timestamp = Date.parse(`${businessDate}T00:00:00.000Z`);
    if (Number.isFinite(timestamp)) this.lastAuditBusinessDate = timestamp / 1000;
  }

  @OnEvent(WEBHOOK_DELIVERY_FAILED)
  onWebhookDeliveryFailed(_payload: WebhookDeliveryFailedEvent) {
    this.webhookDeliveryFailures += 1;
  }

  render(): string {
    const lines = [
      '# HELP haip_http_requests_total HTTP requests grouped by stable route template and status.',
      '# TYPE haip_http_requests_total counter',
    ];

    for (const [key, value] of [...this.http.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [method = '', route = '', status = '0'] = key.split('\u0000');
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
      lines.push(`haip_http_requests_total{${labels}} ${value.count}`);
    }

    lines.push(
      '# HELP haip_http_request_errors_total HTTP 5xx responses grouped by stable route template and status.',
      '# TYPE haip_http_request_errors_total counter',
    );
    for (const [key, value] of [...this.http.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (value.errors === 0) continue;
      const [method = '', route = '', status = '0'] = key.split('\u0000');
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
      lines.push(`haip_http_request_errors_total{${labels}} ${value.errors}`);
    }

    lines.push(
      '# HELP haip_http_request_duration_seconds_sum Total HTTP request duration by route template.',
      '# TYPE haip_http_request_duration_seconds_sum counter',
      '# HELP haip_http_request_duration_seconds_count Number of timed HTTP requests by route template.',
      '# TYPE haip_http_request_duration_seconds_count counter',
    );
    const durationByRoute = new Map<string, { sum: number; count: number }>();
    for (const [key, value] of this.http.entries()) {
      const [method = '', route = ''] = key.split('\u0000');
      const routeKey = `${method}\u0000${route}`;
      const current = durationByRoute.get(routeKey) ?? { sum: 0, count: 0 };
      current.sum += value.durationSeconds;
      current.count += value.count;
      durationByRoute.set(routeKey, current);
    }
    for (const [key, value] of [...durationByRoute.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [method = '', route = ''] = key.split('\u0000');
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
      lines.push(`haip_http_request_duration_seconds_sum{${labels}} ${value.sum}`);
      lines.push(`haip_http_request_duration_seconds_count{${labels}} ${value.count}`);
    }

    lines.push(
      '# HELP haip_booking_create_total Booking creation HTTP outcomes.',
      '# TYPE haip_booking_create_total counter',
      `haip_booking_create_total{outcome="success"} ${this.bookingCreates.success}`,
      `haip_booking_create_total{outcome="failed"} ${this.bookingCreates.failed}`,
      '# HELP haip_channel_sync_total Channel sync outcomes emitted by the channel service.',
      '# TYPE haip_channel_sync_total counter',
      `haip_channel_sync_total{outcome="success"} ${this.channelSyncs.success}`,
      `haip_channel_sync_total{outcome="failed"} ${this.channelSyncs.failed}`,
      '# HELP haip_night_audit_runs_total Night audit completion outcomes.',
      '# TYPE haip_night_audit_runs_total counter',
      `haip_night_audit_runs_total{outcome="success"} ${this.nightAudits.success}`,
      `haip_night_audit_runs_total{outcome="failed"} ${this.nightAudits.failed}`,
      '# HELP haip_night_audit_last_business_date_timestamp_seconds Last completed audit business date at UTC midnight.',
      '# TYPE haip_night_audit_last_business_date_timestamp_seconds gauge',
      `haip_night_audit_last_business_date_timestamp_seconds ${this.lastAuditBusinessDate}`,
      '# HELP haip_webhook_delivery_failures_total Webhook deliveries that exhausted all retry attempts.',
      '# TYPE haip_webhook_delivery_failures_total counter',
      `haip_webhook_delivery_failures_total ${this.webhookDeliveryFailures}`,
      '# HELP process_uptime_seconds Node.js process uptime.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${process.uptime()}`,
    );

    return `${lines.join('\n')}\n`;
  }
}
