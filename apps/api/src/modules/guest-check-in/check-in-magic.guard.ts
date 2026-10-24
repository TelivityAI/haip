import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyCheckInToken, type CheckInTokenPayload } from './check-in-token';

export type CheckInPrincipal = CheckInTokenPayload;

@Injectable()
export class CheckInMagicGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('AUTH_ENABLED', 'true') === 'false') {
      // Demo mode: allow optional token; controllers still need reservation context.
      const req = context.switchToHttp().getRequest<any>();
      const token = this.extractToken(req);
      if (token) {
        const secret = this.secret();
        const payload = verifyCheckInToken(token, secret);
        if (payload) req.checkIn = payload;
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<any>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Check-in token required');
    }
    const payload = verifyCheckInToken(token, this.secret());
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired check-in token');
    }
    req.checkIn = payload as CheckInPrincipal;
    return true;
  }

  private secret(): string {
    return (
      this.config.get<string>('CHECK_IN_MAGIC_SECRET') ||
      this.config.get<string>('JWT_SECRET') ||
      this.config.get<string>('SESSION_SECRET') ||
      'dev-check-in-secret-change-me'
    );
  }

  private extractToken(req: any): string | undefined {
    const header = req.headers?.['x-check-in-token'];
    if (typeof header === 'string' && header.length > 0) return header;
    const auth = req.headers?.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    const q = req.query?.token;
    if (typeof q === 'string' && q.length > 0) return q;
    return undefined;
  }
}
