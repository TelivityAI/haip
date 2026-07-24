import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BurnLoyaltyPointsDto,
  EarnLoyaltyPointsDto,
  ListLoyaltyAccountsDto,
  ReleasePendingLoyaltyDto,
  UpsertLoyaltyProgramDto,
} from './dto/loyalty.dto';
import { LoyaltyService } from './loyalty.service';

@ApiTags('loyalty')
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Post('programs')
  @ApiOperation({ summary: 'Create or update the loyalty program for an organization' })
  @ApiResponse({ status: 201, description: 'Upserted loyalty program' })
  @HttpCode(HttpStatus.CREATED)
  upsertProgram(@Body() dto: UpsertLoyaltyProgramDto) {
    return this.loyaltyService.upsertProgram(dto);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'List loyalty accounts for an organization, optionally filtered by guest' })
  getAccounts(@Query() dto: ListLoyaltyAccountsDto) {
    return this.loyaltyService.getAccounts(dto);
  }

  @Post('earn')
  @ApiOperation({ summary: 'Earn loyalty points into pending balance based on nights stayed' })
  @HttpCode(HttpStatus.CREATED)
  earn(@Body() dto: EarnLoyaltyPointsDto) {
    return this.loyaltyService.earn(dto);
  }

  @Post('release-pending')
  @ApiOperation({ summary: 'Move matured pending loyalty points into available balance' })
  releasePending(@Body() dto: ReleasePendingLoyaltyDto) {
    return this.loyaltyService.releasePending(dto);
  }

  @Post('burn')
  @ApiOperation({ summary: 'Burn available loyalty points' })
  @HttpCode(HttpStatus.CREATED)
  burn(@Body() dto: BurnLoyaltyPointsDto) {
    return this.loyaltyService.burn(dto);
  }
}
