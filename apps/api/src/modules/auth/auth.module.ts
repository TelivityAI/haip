import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { PropertyScopeGuard } from './property-scope.guard';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import { ApiKeyGuard } from './api-key.guard';
import { WsAuthService } from './ws-auth.service';

/**
 * Authentication & Authorization module.
 *
 * Uses Keycloak as the OIDC provider. JWT tokens issued by Keycloak
 * are validated against the JWKS endpoint.
 *
 * AUTH_ENABLED env var controls whether auth is enforced:
 * - 'false' (default) — all requests pass through, no JWT required
 * - 'true' — JWT required on all endpoints except @Public()
 *
 * Guards are registered globally:
 * 1. JwtAuthGuard — validates JWT (or skips if AUTH_ENABLED=false)
 * 2. RolesGuard — checks @Roles() decorator (or skips if AUTH_ENABLED=false)
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
  ],
  providers: [
    // Register JWT strategy unless auth is explicitly disabled.
    // The guards (JwtAuthGuard / RolesGuard) are secure-by-default — they enforce
    // auth unless AUTH_ENABLED === 'false' — so the strategy must be registered
    // to match. The strategy is lazy — it only connects to JWKS when a token is
    // actually validated, so no runtime cost when auth is off.
    {
      provide: JwtStrategy,
      useFactory: (configService: ConfigService) => {
        const authEnabled = configService.get<string>('AUTH_ENABLED', 'true');
        if (authEnabled === 'false') {
          // Return a no-op strategy when auth is explicitly disabled
          return {} as JwtStrategy;
        }
        return new JwtStrategy(configService);
      },
      inject: [ConfigService],
    },
    // Global guards — applied to ALL endpoints, in order:
    // 1. JwtAuthGuard populates req.user, 2. RolesGuard checks @Roles(),
    // 3. PropertyScopeGuard binds the principal to the request's propertyId,
    // 4. PermissionsGuard checks @RequirePermissions() (local authz). All
    // short-circuit to allow when AUTH_ENABLED=false.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PropertyScopeGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Resolves effective permissions from the local RBAC tables. Exported so the
    // admin module can reuse it.
    PermissionsService,
    // WebSocket token verifier — used by gateways that cannot rely on
    // passport HTTP guards (e.g. EventsGateway). Registered always; the
    // gateway itself honours AUTH_ENABLED=false as a dev bypass.
    WsAuthService,
    ApiKeyGuard,
  ],
  exports: [WsAuthService, ApiKeyGuard, PermissionsService],
})
export class AuthModule {}
