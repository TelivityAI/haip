import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<{
      method?: string;
      baseUrl?: string;
      route?: { path?: string };
    }>();
    const response = http.getResponse<{ statusCode?: number }>();
    const method = request.method ?? 'UNKNOWN';
    // baseUrl + route.path are router templates (e.g. /reservations/:id), not
    // raw URLs. This prevents guest ids, confirmation numbers, and property ids
    // from becoming unbounded Prometheus labels.
    const route = `${request.baseUrl ?? ''}${request.route?.path ?? ''}` || 'unmatched';
    const started = process.hrtime.bigint();
    let recorded = false;
    const record = (statusCode: number) => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      this.metrics.observeHttp(method, route, statusCode, durationSeconds);
    };

    return next.handle().pipe(tap({
      next: () => record(response.statusCode ?? 200),
      error: (error: unknown) => {
        const status = typeof (error as { getStatus?: unknown })?.getStatus === 'function'
          ? (error as { getStatus: () => number }).getStatus()
          : 500;
        record(status);
      },
    }));
  }
}
