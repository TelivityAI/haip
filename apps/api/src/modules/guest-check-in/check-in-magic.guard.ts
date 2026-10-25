import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveCheckInMagicSecret } from './check-in-secret';
import { verifyCheckInToken, type CheckInTokenPayload } from './check-in-token';

export type CheckInPrincipal = CheckInTokenPayload;

@Injectable()
export class CheckInMagicGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Check-in token required');
    }
    const payload = verifyCheckInToken(token, resolveCheckInMagicSecret(this.config));
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired check-in token');
    }
    req.checkIn = payload as CheckInPrincipal;
    return true;
  }

  private extractToken(req: any): string | undefined {
    const header = req.headers?.['x-check-in-token'];
    if (typeof header === 'string' && header.length > 0) return header;
    const auth = req.headers?.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    // Query tokens are bootstrap-only (magic link / payment return). Mutating
    // methods must use the header after the booking UI strips ?token=.
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const q = req.query?.token;
      if (typeof q === 'string' && q.length > 0) return q;
    }
    return undefined;
  }
}
