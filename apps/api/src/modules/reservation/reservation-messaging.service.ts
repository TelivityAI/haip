import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { reservations, guests } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { EmailService } from '../agent/guest-comms/email.service';
import { ComposeMessageDto } from './dto/compose-message.dto';

/**
 * Guest messaging from a reservation (Tier 4 — Reservation Operations Polish).
 *
 * Resolves the reservation's guest (tenant-scoped) and sends an email via the
 * shared EmailService. When SMTP is unconfigured EmailService returns a draft
 * result ({ sent: false }) rather than throwing. Marketing messages respect the
 * guest's GDPR marketing opt-out.
 *
 * Out of scope: persistent message log (no message-log table) — compose/send only.
 */
@Injectable()
export class ReservationMessagingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly emailService: EmailService,
    private readonly webhookService: WebhookService,
  ) {}

  async composeMessage(propertyId: string, reservationId: string, dto: ComposeMessageDto) {
    // Tenant-scoped reservation lookup.
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.propertyId, propertyId),
        ),
      );
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, reservation.guestId));
    if (!guest) {
      throw new NotFoundException(`Guest ${reservation.guestId} not found`);
    }
    if (!guest.email) {
      throw new BadRequestException('Guest has no email address on file');
    }

    if (dto.isMarketing === true && guest.gdprConsentMarketing === false) {
      throw new ForbiddenException(
        'Guest has not consented to marketing communications (GDPR opt-out)',
      );
    }

    const result = await this.emailService.send({
      to: guest.email,
      subject: dto.subject,
      html: dto.body,
      text: dto.body,
    });

    await this.webhookService.emit(
      'reservation.message_sent',
      'reservation',
      reservationId,
      {
        reservationId,
        to: guest.email,
        subject: dto.subject,
        sent: result.sent,
        isMarketing: dto.isMarketing ?? false,
      },
      propertyId,
    );

    return result;
  }
}
