import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './public.decorator';
import { dashboardAuthConfig } from './oidc-config';

/**
 * Runtime auth settings for the dashboard SPA (issue #388): the published image
 * no longer needs a rebuild per environment. Public by design — it returns only
 * what the browser needs to start a login (issuer, client id, scope), never a
 * secret.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Dashboard login settings (public, no secrets)' })
  getConfig() {
    return dashboardAuthConfig((key) => this.configService.get<string>(key));
  }
}
