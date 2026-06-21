import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { WsAuthService } from '../auth/ws-auth.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { userCanAccessProperty } from '../auth/property-access';

/**
 * Events gateway — real-time PMS event broadcasts.
 *
 * Security model:
 * - On connect: verify a JWT passed via `handshake.auth.token` or `?token=`.
 *   Invalid/missing tokens cause immediate disconnect.
 * - On joinProperty: the requested propertyId must appear in the user's
 *   JWT `property_ids` custom claim (mapped onto AuthUser.propertyIds).
 *   Admin/platform roles can join any property.
 * - Dev bypass: when AUTH_ENABLED=false (matching the HTTP JwtAuthGuard),
 *   connections skip verification to keep local dev frictionless. Production
 *   defaults to enforced.
 */
@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);
  private readonly authEnabled: boolean;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly configService: ConfigService,
  ) {
    this.authEnabled =
      this.configService.get<string>('AUTH_ENABLED', 'true') !== 'false';
  }

  async handleConnection(client: Socket) {
    if (!this.authEnabled) {
      this.logger.log(`Client connected (auth disabled): ${client.id}`);
      return;
    }

    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`Rejecting WS ${client.id}: no token`);
      client.disconnect(true);
      return;
    }

    try {
      const user = await this.wsAuth.verify(token);
      client.data.user = user;
      this.logger.log(`Client connected: ${client.id} (sub=${user.sub})`);
    } catch (err: any) {
      this.logger.warn(
        `Rejecting WS ${client.id}: token verification failed — ${err?.message ?? err}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinProperty')
  handleJoinProperty(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { propertyId: string },
  ) {
    if (!data?.propertyId) return;

    if (this.authEnabled) {
      const user = client.data.user as AuthUser | undefined;
      if (!user) {
        client.emit('error', { message: 'Not authenticated' });
        return;
      }
      if (!this.userCanAccessProperty(user, data.propertyId)) {
        this.logger.warn(
          `WS ${client.id} (sub=${user.sub}) denied joinProperty ${data.propertyId}`,
        );
        client.emit('error', {
          message: 'Forbidden: not a member of this property',
          propertyId: data.propertyId,
        });
        return;
      }
    }

    const room = `property:${data.propertyId}`;
    client.join(room);
    this.logger.debug(`Client ${client.id} joined room ${room}`);
  }

  @SubscribeMessage('leaveProperty')
  handleLeaveProperty(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { propertyId: string },
  ) {
    if (!data?.propertyId) return;
    const room = `property:${data.propertyId}`;
    client.leave(room);
    this.logger.debug(`Client ${client.id} left room ${room}`);
  }

  broadcastToProperty(propertyId: string, event: string, data: unknown) {
    const room = `property:${propertyId}`;
    this.server.to(room).emit('pmsEvent', {
      event,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  private extractToken(client: Socket): string | null {
    const authToken = (client.handshake.auth as any)?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken.replace(/^Bearer\s+/i, '');
    }
    const queryToken = client.handshake.query?.['token'];
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }
    const headerAuth = client.handshake.headers?.authorization;
    if (typeof headerAuth === 'string' && headerAuth.length > 0) {
      return headerAuth.replace(/^Bearer\s+/i, '');
    }
    return null;
  }

  private userCanAccessProperty(user: AuthUser, propertyId: string): boolean {
    // Shared with the HTTP PropertyScopeGuard so socket and REST scoping can't drift.
    return userCanAccessProperty(user, propertyId);
  }
}
