import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BookingRequestService } from './booking-request.service';
import { BookingRequestMailerService } from './booking-request-mailer.service';

const SCAN_INTERVAL_MS = 30_000;

/** Startup and recurring recovery driver for the booking-request outbox. */
@Injectable()
export class BookingRequestConsequenceWorkerService
implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(
    BookingRequestConsequenceWorkerService.name,
  );
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(BookingRequestService)
    private readonly bookingRequests: BookingRequestService,
    @Inject(BookingRequestMailerService)
    private readonly mailer: BookingRequestMailerService,
  ) {}

  onModuleInit(): void {
    if (process.env['NODE_ENV'] === 'test') return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), SCAN_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.bookingRequests.processPendingConsequences();
    } catch (error: unknown) {
      this.logger.error(
        'Booking request consequence recovery scan failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
    try {
      await this.mailer.processPendingDeliveries();
    } catch (error: unknown) {
      this.logger.error(
        'Booking request email recovery scan failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
