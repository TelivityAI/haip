import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import type { AuthUser } from './current-user.decorator';
import {
  azpAllowed,
  principalFromPayload,
  resolveOidcVerifierConfig,
  type OidcVerifierConfig,
} from './oidc-config';

/**
 * JWT Strategy — validates JWTs from Keycloak or, with OIDC_ISSUER set, from
 * any OIDC provider (see oidc-config.ts).
 *
 * Fetches the provider's public signing keys via JWKS endpoint.
 * Extracts user info, roles and property scope from the JWT claims.
 *
 * Audience enforcement:
 * - `aud` is validated against KEYCLOAK_CLIENT_ID (or KEYCLOAK_AUDIENCE if set).
 * - Keycloak also emits `azp` (authorized party) identifying the client that
 *   obtained the token. We enforce `azp === expected` in validate() so tokens
 *   from other realm clients cannot be replayed against this API.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly oidc: OidcVerifierConfig;

  constructor(configService: ConfigService) {
    const oidc = resolveOidcVerifierConfig((key) => configService.get<string>(key));

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer: oidc.issuer,
      audience: oidc.audience,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: oidc.jwksUri,
      }),
    });

    // Additional realm clients allowed to CALL this API (service accounts
    // integrating over the public API). `azp` is immutably the client that
    // obtained the token, so a second client can never satisfy a single-value
    // equality no matter what mappers it carries -- while `aud` stays the
    // single audience above, which any caller can add via an audience mapper.
    // Unset, behaviour is exactly as before: only the primary client passes.
    // With a generic OIDC issuer, `*` accepts any azp: the `aud` check above is
    // then the boundary (one service account per integration can't be listed).
    this.oidc = oidc;
  }

  /**
   * Passport calls this after JWT signature + issuer + audience are verified.
   * We additionally enforce `azp` (Keycloak's authorized-party claim) so that
   * access tokens minted for a different realm client cannot pass through.
   * Returns the user object attached to req.user.
   */
  validate(payload: any): AuthUser {
    if (!azpAllowed(this.oidc, payload.azp)) {
      throw new UnauthorizedException('Invalid token audience (azp mismatch)');
    }
    return principalFromPayload(payload, this.oidc);
  }
}
