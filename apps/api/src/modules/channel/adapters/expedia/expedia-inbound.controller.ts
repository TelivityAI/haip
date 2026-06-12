import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../../auth/public.decorator';
import { InboundReservationService } from '../../inbound-reservation.service';
import { ChannelService } from '../../channel.service';
import { parseExpediaResponse } from './expedia.xml';
import { mapExpediaBookingToHaip } from './expedia.reservation-mapper';

/**
 * Inbound receiver for Expedia Booking Notification pushes (new/modified/
 * cancelled bookings). @Public() — Expedia can't authenticate to our IdP.
 */
@ApiTags('Channel Manager — Expedia')
@Controller('channels/inbound/expedia')
@Public()
export class ExpediaInboundController {
  private readonly logger = new Logger(ExpediaInboundController.name);

  constructor(
    private readonly inboundReservationService: InboundReservationService,
    private readonly channelService: ChannelService,
  ) {}

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
      const connection = connections[0];
      if (!connection) {
        this.logger.error('No active Expedia channel connection found');
        return res.status(500).send('No active Expedia connection configured');
      }

      for (const reservation of reservations) {
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
