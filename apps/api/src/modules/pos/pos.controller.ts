import { Controller, Post, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { ApiKeyGuard, type ConnectPrincipal } from '../auth/api-key.guard';
import { ConnectScopeGuard } from '../auth/connect-scope.guard';
import { PosService } from './pos.service';
import { PostPosChargeDto } from './dto/post-pos-charge.dto';

/**
 * POS integration API (`/api/v1/pos/*`). Machine-to-machine: authenticated by an
 * `x-api-key` (ApiKeyGuard) and tenant-isolated by ConnectScopeGuard, mirroring
 * the Connect API. A property-scoped key can only post onto its own folios.
 */
@ApiTags('pos')
@ApiSecurity('api-key')
@Controller('pos')
@Public()
@UseGuards(ApiKeyGuard, ConnectScopeGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Post('charges')
  @ApiOperation({ summary: 'Post an outlet charge to a guest folio (POS → folio)' })
  @ApiResponse({ status: 201, description: 'The posted charge' })
  postCharge(@Body() dto: PostPosChargeDto, @Req() req: any) {
    const principal = req.connect as ConnectPrincipal | undefined;
    // Pin the tenant from the credential for property-scoped keys (the DTO's
    // propertyId is ignored / already verified by ConnectScopeGuard). A
    // platform-scoped caller must supply propertyId explicitly.
    let propertyId = dto.propertyId;
    if (principal?.scope === 'property' && principal.propertyId) {
      propertyId = principal.propertyId;
    }
    if (!propertyId) {
      throw new ForbiddenException('propertyId is required for platform-scoped callers');
    }
    return this.posService.postCharge(propertyId, dto);
  }
}
