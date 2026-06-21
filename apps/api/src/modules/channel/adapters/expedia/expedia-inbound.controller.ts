import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../../auth/public.decorator';
import { InboundReservationService } from '../../inbound-reservation.service';
import { ChannelService } from '../../channel.service';
import { parseExpediaResponse } from './expedia.xml';
import { mapExpediaBookingToHaip } from './expedia.reservation-mapper';
import {
  verifyHmacSignature,
  getInboundAuth,
  type InboundHmacAuth,
} from '../inbound-auth.util';

/**
 * Inbound receiver for Expedia Booking Notification pushes. @Public() — Expedia
 * can't authenticate to our IdP. Caller authentication is an HMAC-SHA256 over the
 * raw body using the per-connection shared secret stored in
 * `connection.config.inboundAuth.secret`. Header: `x-expedia-signature` (hex,
 * optional `sha256=` prefix). Routing remains by `hotelId`, and the signature is
 * verified against THAT connection's secret — so an attacker can't inject a
 * booking for tenant B by sending tenant A's signed payload. Closes CRITICAL #3.
 * `AUTH_ENABLED=false` is a no-op (demo parity).
 */
@ApiTags('Channel Manager — Expedia')
@Controller('channels/inbound/expedia')
@Public()
export class ExpediaInboundController {
  private readonly logger = new Logger(ExpediaInboundController.name);

  constructor(
    private readonly inboundReservationService: InboundReservationService,
    private readonly channelService: ChannelService,
    private readonly configService: ConfigService,
  ) {}

  private get authEnabled(): boolean {
    return this.configService.get<string>('AUTH_ENABLED', 'true') !== 'false';
  }

  private isAuthorizedFor(connection: any, signatureHeader: string | undefined, rawBody: string): boolean {
    if (!this.authEnabled) return true;
    const stored = getInboundAuth<InboundHmacAuth>(connection.config);
    return verifyHmacSignature(signatureHeader, rawBody, stored);
  }

  @Post('bookings')
  @ApiOperation({ summary: 'Receive an inbound booking notification from Expedia (XML)' })
  @ApiExcludeEndpoint()
  async receiveBooking(@Req() req: any, @Res() res: any) {
    try {
      const rawBody = await this.readRawBody(req);
      if (!rawBody) return res.status(400).send('Empty request body');

      const parsed = parseExpediaResponse(rawBody);
      const reservations = mapExpediaBookingToHaip(parsed.data);
      if (reservations.length === 0) {
        this.logger.warn('Expedia push contained no bookings');
        return res.status(400).send('No bookings in payload');
      }

      const connections = await this.channelService.findByAdapterType('expedia');
      if (connections.length === 0) {
        this.logger.error('No active Expedia channel connection found');
        return res.status(500).send('No active Expedia connection configured');
      }

      const signatureHeader = (req.headers?.['x-expedia-signature'] ?? req.headers?.['X-Expedia-Signature']) as string | undefined;

      for (const reservation of reservations) {
        // Route to the connection whose config.hotelId matches the booking's hotel.
        // NEVER fall back to connections[0]: with two tenants on Expedia that would
        // attribute the booking to an arbitrary property (confused-deputy).
        const hotelId = reservation.channelHotelId;
        const connection = hotelId
          ? connections.find((c: any) => String((c.config ?? {}).hotelId ?? '') === hotelId)
          : undefined;
        if (!connection) {
          this.logger.error(
            `Expedia booking ${reservation.externalConfirmation}: no connection matches hotelId='${hotelId ?? '(missing)'}' — rejected`,
          );
          continue;
        }
        // Verify the HMAC signature against the resolved connection's stored secret.
        if (!this.isAuthorizedFor(connection, signatureHeader, rawBody)) {
          this.logger.warn(
            `Expedia booking ${reservation.externalConfirmation}: HMAC signature verification failed for connection ${connection.id} — rejected`,
          );
          // 401 once on the response if any reservation fails auth — the whole
          // request was forged or misconfigured.
          return res.status(401).send('<BookingNotificationRS><Error>Unauthorized</Error></BookingNotificationRS>');
        }
        try {
          await this.inboundReservationService.processInboundReservation(connection.id, reservation);
        } catch (error: any) {
          this.logger.error(`Failed to process Expedia booking ${reservation.externalConfirmation}: ${error.message}`);
        }
      }
      return res.status(200).send('<BookingNotificationRS/>');
    } catch (error: any) {
      this.logger.error(`Expedia inbound error: ${error.message}`, error.stack);
      return res.status(500).send('Internal processing error');
    }
  }

  private readRawBody(req: any): Promise<string> {
    return new Promise((resolve) => {
      if (req.rawBody) {
        resolve(typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString());
        return;
      }
      if (typeof req.body === 'string') {
        resolve(req.body);
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
  }
}
