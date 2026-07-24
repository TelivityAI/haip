import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, type ConnectPrincipal } from '../auth/api-key.guard';
import { ConnectScopeGuard } from '../auth/connect-scope.guard';
import { Public } from '../auth/public.decorator';
import { PostFolioInboundChargeDto } from './dto/post-folio-inbound-charge.dto';
import { FolioInboundService } from './folio-inbound.service';

@ApiTags('folio-inbound')
@ApiSecurity('api-key')
@Controller('folio-inbound')
@Public()
@UseGuards(ApiKeyGuard, ConnectScopeGuard)
export class FolioInboundController {
  constructor(private readonly folioInboundService: FolioInboundService) {}

  @Post('charges')
  @ApiOperation({ summary: 'Post an external incidental charge to the in-house guest folio' })
  @ApiResponse({ status: 201, description: 'The posted charge or the existing charge for a duplicate vendorTxnId' })
  postCharge(@Body() dto: PostFolioInboundChargeDto, @Req() req: any) {
    const principal = req.connect as ConnectPrincipal | undefined;
    if (!principal?.propertyId) {
      throw new ForbiddenException('folio inbound requires a property-scoped API key');
    }
    return this.folioInboundService.postCharge(principal.propertyId, dto);
  }
}
