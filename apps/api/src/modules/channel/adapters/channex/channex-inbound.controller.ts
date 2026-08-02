import { Controller, Post, Req, Res, Logger, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../../auth/public.decorator';
import { InboundReservationService } from '../../inbound-reservation.service';
import { ChannelService } from '../../channel.service';
import { getInboundAuth, type InboundHmacAuth } from '../inbound-auth.util';
import { mapChannexRevisionToHaip } from './channex.mapper';

/**
 * Inbound webhook receiver for Channex booking events.
 *
 * Register in Channex (staging or prod):
 *   callback_url: https://<haip-host>/api/v1/channels/inbound/channex/bookings
 *   event_mask: booking  (or booking_new;booking_modification;booking_cancellation)
 *   headers: { "X-Channex-Webhook-Secret": "<shared-secret>" }
 *   send_data: true  (preferred) — payload includes revision/booking attributes
 *   send_data: false — notification only; HAIP pulls booking_revisions/feed
 *
 * Auth: shared secret via `X-Channex-Webhook-Secret` matched to
 * `connection.config.inboundAuth.secret` for the property-routed connection.
 * `AUTH_ENABLED=false` skips secret checks (local demo).
 */
@ApiTags('Channel Manager — Channex')
@Controller('channels/inbound/channex')
@Public()
export class ChannexInboundController {
  private readonly logger = new Logger(ChannexInboundController.name);

  constructor(
    private readonly inboundReservationService: InboundReservationService,
    private readonly channelService: ChannelService,
    private readonly configService: ConfigService,
  ) {}

  private get authEnabled(): boolean {
    return this.configService.get<string>('AUTH_ENABLED', 'true') !== 'false';
  }

  private secretsEqual(provided: string, expected: string): boolean {
    const ha = createHash('sha256').update(provided, 'utf8').digest();
    const hb = createHash('sha256').update(expected, 'utf8').digest();
    return timingSafeEqual(ha, hb);
  }

  private isAuthorizedFor(connection: any, secretHeader: string | undefined): boolean {
    if (!this.authEnabled) return true;
    const stored = getInboundAuth<InboundHmacAuth>(connection.config);
    if (!stored?.secret || !secretHeader) return false;
    return this.secretsEqual(secretHeader.trim(), stored.secret);
  }

  @Post('bookings')
  @ApiOperation({ summary: 'Receive inbound booking webhook from Channex' })
  @ApiExcludeEndpoint()
  async receiveBooking(
    @Req() req: any,
    @Res() res: any,
    @Headers('x-channex-webhook-secret') secretHeader?: string,
  ) {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const propertyId = this.extractPropertyId(body);
      if (!propertyId) {
        this.logger.warn('Channex webhook missing property_id');
        return res.status(400).json({ error: 'property_id required' });
      }

      const connections = await this.channelService.findByAdapterType('channex');
      const connection = connections.find((c: any) => {
        const cfg = (c.config ?? {}) as Record<string, unknown>;
        return (
          String(cfg['propertyId'] ?? '') === propertyId ||
          String(cfg['hotelId'] ?? '') === propertyId
        );
      });

      if (!connection) {
        this.logger.error(`Channex webhook: no connection matches property_id=${propertyId}`);
        return res.status(404).json({ error: 'No matching Channex connection' });
      }

      if (!this.isAuthorizedFor(connection, secretHeader)) {
        this.logger.warn(`Channex webhook unauthorized for connection ${connection.id}`);
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Prefer embedded revision payload (send_data=true); otherwise pull the feed.
      // Channex "Send test message" often posts a stub/data wrapper without a real
      // booking revision — ACK those with 200 so webhook delivery succeeds.
      const revision = this.extractRevision(body);
      if (revision) {
        const mapped = mapChannexRevisionToHaip(revision, propertyId);
        if (!mapped) {
          this.logger.warn(
            `Channex webhook: no usable booking revision for property_id=${propertyId} — acking`,
          );
          return res.status(200).json({ ok: true, ack: 'no_usable_revision' });
        }
        await this.inboundReservationService.processInboundReservation(connection.id, mapped);
      } else {
        await this.inboundReservationService.pullAndProcessReservations(
          connection.id,
          connection.propertyId,
        );
      }

      return res.status(200).json({ ok: true });
    } catch (error: any) {
      this.logger.error(`Channex inbound error: ${error.message}`, error.stack);
      return res.status(500).json({ error: 'Internal processing error' });
    }
  }

  private extractPropertyId(body: Record<string, unknown>): string | undefined {
    const direct = body['property_id'] ?? body['propertyId'];
    if (typeof direct === 'string' && direct) return direct;

    const attrs = body['attributes'] as Record<string, unknown> | undefined;
    if (attrs && typeof attrs['property_id'] === 'string') return attrs['property_id'];

    const booking = (attrs?.['booking'] ?? body['booking']) as Record<string, unknown> | undefined;
    if (booking && typeof booking['property_id'] === 'string') return booking['property_id'];

    const data = body['data'] as Record<string, unknown> | undefined;
    if (data) {
      const dataAttrs = data['attributes'] as Record<string, unknown> | undefined;
      if (dataAttrs && typeof dataAttrs['property_id'] === 'string') return dataAttrs['property_id'];
      const dataBooking = dataAttrs?.['booking'] as Record<string, unknown> | undefined;
      if (dataBooking && typeof dataBooking['property_id'] === 'string') {
        return dataBooking['property_id'];
      }
    }
    return undefined;
  }

  private extractRevision(body: Record<string, unknown>): Record<string, unknown> | null {
    // Full revision object
    if (body['id'] && (body['attributes'] || body['booking'] || body['rooms'])) {
      return body;
    }
    const data = body['data'];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const row = data as Record<string, unknown>;
      if (row['id'] || row['attributes'] || row['booking']) return row;
    }
    if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
      return data[0] as Record<string, unknown>;
    }
    // Payload with booking but no revision wrapper
    if (body['booking'] && typeof body['booking'] === 'object') {
      return body;
    }
    return null;
  }
}
