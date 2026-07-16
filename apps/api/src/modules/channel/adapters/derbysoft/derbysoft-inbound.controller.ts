import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { and, eq } from 'drizzle-orm';
import { channelConnections } from '@telivityhaip/database';
import { Public } from '../../../auth/public.decorator';
import { DRIZZLE } from '../../../../database/database.module';
import { InboundReservationService } from '../../inbound-reservation.service';
import { AvailabilityService } from '../../../reservation/availability.service';
import {
  verifyBearerAuth,
  getInboundAuth,
  type InboundBearerAuth,
} from '../inbound-auth.util';
import {
  mapDerbySoftReservationToHaip,
  mapCancelToHaip,
  buildBookResponse,
  buildCancelResponse,
  buildErrorResponse,
  buildHeader,
} from './derbysoft.mapper';

/**
 * DerbySoft Property Connector → PMS webhooks (PUSH/PUSH).
 *
 * Paths mirror the PC Integration API (Live Check / Book / Modify / Cancel / Ping).
 * Auth: Bearer token against the resolved connection's `config.inboundAuth.bearerToken`.
 * Routing: `hotelId` in body must match connection `config.hotelId`.
 *
 * PCI: payment card fields from Book/Modify are never persisted (stripped in mapper).
 */
@ApiTags('Channel Manager — DerbySoft')
@Controller('channels/inbound/derbysoft')
@Public()
export class DerbySoftInboundController {
  private readonly logger = new Logger(DerbySoftInboundController.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly inboundReservationService: InboundReservationService,
    private readonly availabilityService: AvailabilityService,
    private readonly configService: ConfigService,
  ) {}

  private get authEnabled(): boolean {
    return this.configService.get<string>('AUTH_ENABLED', 'true') !== 'false';
  }

  private isAuthorizedFor(connection: any, authHeader: string | undefined): boolean {
    if (!this.authEnabled) return true;
    const stored = getInboundAuth<InboundBearerAuth>(connection.config);
    return verifyBearerAuth(authHeader, stored);
  }

  private async findConnection(hotelId: string | undefined) {
    if (!hotelId) return null;
    const rows = await this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.adapterType, 'derbysoft'),
          eq(channelConnections.status, 'active'),
        ),
      );
    return (
      rows.find((c: any) => {
        const cfg = (c.config ?? {}) as Record<string, unknown>;
        return cfg['hotelId'] === hotelId || cfg['hotelCode'] === hotelId;
      }) ?? null
    );
  }

  private async readJson(req: any): Promise<Record<string, unknown> | null> {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body as Record<string, unknown>;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private echoToken(body: Record<string, unknown> | null): string | undefined {
    const header = body?.['header'] as Record<string, unknown> | undefined;
    return header?.['echoToken'] != null ? String(header['echoToken']) : undefined;
  }

  @Post('ping')
  @ApiOperation({ summary: 'DerbySoft Ping' })
  @ApiExcludeEndpoint()
  async ping(@Req() req: any, @Res() res: any) {
    const body = (await this.readJson(req)) ?? {};
    return res.status(200).json({
      header: { ...buildHeader(this.echoToken(body)), timeStamp: new Date().toISOString() },
    });
  }

  /**
   * Live Check — real-time availability for a stay range.
   * Returns product-level open/close based on HAIP AvailabilityService.
   */
  @Post('availability')
  @ApiOperation({ summary: 'DerbySoft Live Check' })
  @ApiExcludeEndpoint()
  async liveCheck(@Req() req: any, @Res() res: any) {
    const body = await this.readJson(req);
    if (!body) {
      return res.status(500).json(buildErrorResponse(undefined, 'InvalidField', 'Empty body'));
    }

    const hotelId = body['hotelId'] != null ? String(body['hotelId']) : undefined;
    const connection = await this.findConnection(hotelId);
    const authHeader = (req.headers?.['authorization'] ?? req.headers?.['Authorization']) as
      | string
      | undefined;

    if (!connection) {
      return res
        .status(500)
        .json(buildErrorResponse(this.echoToken(body), 'InvalidField', 'Unknown hotelId'));
    }
    if (!this.isAuthorizedFor(connection, authHeader)) {
      return res.status(401).json(buildErrorResponse(this.echoToken(body), 'Unauthorized', 'Unauthorized'));
    }

    const stayRange = (body['stayRange'] ?? {}) as Record<string, unknown>;
    const checkin = String(stayRange['checkin'] ?? '');
    const checkout = String(stayRange['checkout'] ?? '');
    const roomMappings = (connection.roomTypeMapping ?? []) as Array<{
      roomTypeId: string;
      channelRoomCode: string;
    }>;
    const rateMappings = (connection.ratePlanMapping ?? []) as Array<{
      ratePlanId: string;
      channelRateCode: string;
    }>;

    const roomRates: Array<Record<string, unknown>> = [];
    for (const room of roomMappings) {
      try {
        const avail = await this.availabilityService.searchAvailability(
          connection.propertyId,
          checkin,
          checkout,
          room.roomTypeId,
        );
        const minAvail = avail.length
          ? Math.min(...avail.map((a: { available: number }) => a.available))
          : 0;
        for (const rate of rateMappings) {
          roomRates.push({
            roomId: room.channelRoomCode,
            rateId: rate.channelRateCode,
            inventory: { availableInvCount: Math.max(0, minAvail) },
            status: minAvail > 0 ? 'Open' : 'Close',
          });
        }
      } catch (err: any) {
        this.logger.warn(`LiveCheck availability failed for ${room.channelRoomCode}: ${err?.message}`);
      }
    }

    return res.status(200).json({
      header: { ...buildHeader(this.echoToken(body)), timeStamp: new Date().toISOString() },
      hotelId,
      roomRates,
    });
  }

  @Post('book')
  @ApiOperation({ summary: 'DerbySoft Book' })
  @ApiExcludeEndpoint()
  async book(@Req() req: any, @Res() res: any) {
    return this.handleReservation(req, res, 'new');
  }

  @Post('modify')
  @ApiOperation({ summary: 'DerbySoft Modify' })
  @ApiExcludeEndpoint()
  async modify(@Req() req: any, @Res() res: any) {
    return this.handleReservation(req, res, 'modified');
  }

  @Post('cancel')
  @ApiOperation({ summary: 'DerbySoft Cancel' })
  @ApiExcludeEndpoint()
  async cancel(@Req() req: any, @Res() res: any) {
    const body = await this.readJson(req);
    if (!body) {
      return res.status(500).json(buildErrorResponse(undefined, 'InvalidField', 'Empty body'));
    }

    const hotelId = body['hotelId'] != null ? String(body['hotelId']) : undefined;
    const connection = await this.findConnection(hotelId);
    const authHeader = (req.headers?.['authorization'] ?? req.headers?.['Authorization']) as
      | string
      | undefined;

    if (!connection) {
      return res
        .status(500)
        .json(buildErrorResponse(this.echoToken(body), 'InvalidField', 'Unknown hotelId'));
    }
    if (!this.isAuthorizedFor(connection, authHeader)) {
      return res.status(401).json(buildErrorResponse(this.echoToken(body), 'Unauthorized', 'Unauthorized'));
    }

    try {
      const reservation = mapCancelToHaip(body);
      const result = await this.inboundReservationService.processInboundReservation(
        connection.id,
        reservation,
      );
      return res.status(200).json(buildCancelResponse(body, result.confirmationNumber));
    } catch (err: any) {
      this.logger.error(`DerbySoft cancel failed: ${err?.message}`);
      return res
        .status(500)
        .json(buildErrorResponse(this.echoToken(body), 'BusinessError', err?.message ?? 'Cancel failed'));
    }
  }

  private async handleReservation(
    req: any,
    res: any,
    status: 'new' | 'modified',
  ) {
    const body = await this.readJson(req);
    if (!body) {
      return res.status(500).json(buildErrorResponse(undefined, 'InvalidField', 'Empty body'));
    }

    const hotelId = body['hotelId'] != null ? String(body['hotelId']) : undefined;
    const connection = await this.findConnection(hotelId);
    const authHeader = (req.headers?.['authorization'] ?? req.headers?.['Authorization']) as
      | string
      | undefined;

    if (!connection) {
      return res
        .status(500)
        .json(buildErrorResponse(this.echoToken(body), 'InvalidField', 'Unknown hotelId'));
    }
    if (!this.isAuthorizedFor(connection, authHeader)) {
      return res.status(401).json(buildErrorResponse(this.echoToken(body), 'Unauthorized', 'Unauthorized'));
    }

    try {
      const reservation = mapDerbySoftReservationToHaip(body, status);
      const result = await this.inboundReservationService.processInboundReservation(
        connection.id,
        reservation,
      );
      return res.status(200).json(buildBookResponse(body, result.confirmationNumber));
    } catch (err: any) {
      this.logger.error(`DerbySoft ${status} failed: ${err?.message}`);
      return res
        .status(500)
        .json(
          buildErrorResponse(
            this.echoToken(body),
            'BusinessError',
            err?.message ?? `${status} failed`,
          ),
        );
    }
  }
}
