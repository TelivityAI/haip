import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import jwksClient, { JwksClient, SigningKey } from 'jwks-rsa';
import type { AuthUser } from './current-user.decorator';
import {
  azpAllowed,
  principalFromPayload,
  resolveOidcVerifierConfig,
  type OidcVerifierConfig,
} from './oidc-config';

/**
 * Token verifier used by non-HTTP entrypoints (e.g. WebSocket gateway) that
 * cannot go through the passport HTTP strategy. Mirrors JwtStrategy's
 * validation rules: issuer (Keycloak or generic OIDC), audience (aud + azp),
 * RS256 signature fetched from JWKS, and the same claim mapping.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);
  private readonly oidc: OidcVerifierConfig;
  private readonly jwks: JwksClient;

  constructor(configService: ConfigService) {
    // Same resolver as JwtStrategy -- the two verifiers must agree on who
    // may call, or a caller works over HTTP and dies on the socket.
    this.oidc = resolveOidcVerifierConfig((key) => configService.get<string>(key));
    this.jwks = jwksClient({
      jwksUri: this.oidc.jwksUri,
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
          issuer: this.oidc.issuer,
          audience: this.oidc.audience,
        },
        (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        },
      );
    });

    if (!azpAllowed(this.oidc, payload.azp)) {
      throw new Error('Invalid token audience (azp mismatch)');
    }

    return principalFromPayload(payload, this.oidc);
  }
}
