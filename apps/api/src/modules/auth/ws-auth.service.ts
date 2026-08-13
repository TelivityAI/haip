import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import jwksClient, { JwksClient, SigningKey } from 'jwks-rsa';
import type { AuthUser } from './current-user.decorator';

/**
 * Token verifier used by non-HTTP entrypoints (e.g. WebSocket gateway) that
 * cannot go through the passport HTTP strategy. Mirrors JwtStrategy's
 * validation rules: Keycloak issuer, audience (aud + azp), RS256 signature
 * fetched from JWKS.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);
  private readonly issuer: string;
  private readonly expectedAudience: string;
  private readonly allowedAzp: string[];
  private readonly jwks: JwksClient;

  constructor(configService: ConfigService) {
    const keycloakUrl = configService.get<string>('KEYCLOAK_URL', 'http://localhost:8080');
    const realm = configService.get<string>('KEYCLOAK_REALM', 'haip');
    this.issuer = `${keycloakUrl}/realms/${realm}`;
    this.expectedAudience =
      configService.get<string>('KEYCLOAK_AUDIENCE') ||
      configService.get<string>('KEYCLOAK_CLIENT_ID', 'haip-api');
    // Same allow-list as JwtStrategy -- the two verifiers must agree on who
    // may call, or a caller works over HTTP and dies on the socket.
    this.allowedAzp = (configService.get<string>('KEYCLOAK_ALLOWED_AZP') || this.expectedAudience)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.jwks = jwksClient({
      jwksUri: `${this.issuer}/protocol/openid-connect/certs`,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
    });
  }

  /**
   * Verify a bearer token and return the extracted AuthUser.
   * Throws on invalid signature, issuer, audience, or expiration.
   */
  async verify(token: string): Promise<AuthUser> {
    const payload = await new Promise<any>((resolve, reject) => {
      jwt.verify(
        token,
        (header, cb) => {
          if (!header.kid) {
            cb(new Error('Token has no kid'));
            return;
          }
          this.jwks.getSigningKey(header.kid, (err: Error | null, key?: SigningKey) => {
            if (err || !key) {
              cb(err ?? new Error('Signing key not found'));
              return;
            }
            cb(null, key.getPublicKey());
          });
        },
        {
          algorithms: ['RS256'],
          issuer: this.issuer,
          audience: this.expectedAudience,
        },
        (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        },
      );
    });

    if (payload.azp && !this.allowedAzp.includes(payload.azp)) {
      throw new Error('Invalid token audience (azp mismatch)');
    }

    return {
      sub: payload.sub,
      email: payload.email ?? '',
      name: payload.name ?? payload.preferred_username ?? '',
      roles: payload.realm_access?.roles ?? [],
      propertyIds: payload.property_ids ?? undefined,
    };
  }
}
