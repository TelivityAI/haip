import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CheckInMagicGuard, type CheckInPrincipal } from './check-in-magic.guard';
import { GuestCheckInService } from './guest-check-in.service';
import {
  GuestAcceptUpsellDto,
  GuestPayDto,
  GuestPreRegisterDto,
  IssueCheckInLinkDto,
} from './dto/guest-check-in.dto';

@ApiTags('Guest Check-In')
@Controller('guest-check-in')
export class GuestCheckInController {
  constructor(private readonly service: GuestCheckInService) {}

  private principal(req: any): CheckInPrincipal {
    return req.checkIn;
  }

  @Post('links')
  @RequirePermissions('frontdesk.access')
  @ApiOperation({ summary: 'Issue a magic-link token for guest online check-in' })
  issueLink(@Body() dto: IssueCheckInLinkDto) {
    return this.service.issueLinkForReservation(
      dto.propertyId,
      dto.reservationId,
      dto.ttlSeconds,
    );
  }

  @Get('session')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiSecurity('check-in-token')
  @ApiHeader({ name: 'x-check-in-token', required: true })
  @ApiOperation({ summary: 'Guest check-in session (stay + progress)' })
  session(@Req() req: any) {
    return this.service.getSession(this.principal(req));
  }

  @Post('pre-register')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiOperation({ summary: 'Submit registration card, signature, and ID from phone' })
  preRegister(@Req() req: any, @Body() dto: GuestPreRegisterDto) {
    return this.service.preRegister(this.principal(req), dto);
  }

  @Get('upsells')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiOperation({ summary: 'List eligible upsell campaigns for this stay' })
  upsells(@Req() req: any) {
    return this.service.listUpsells(this.principal(req));
  }

  @Post('upsells/accept')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiOperation({ summary: 'Accept an upsell campaign' })
  acceptUpsell(@Req() req: any, @Body() dto: GuestAcceptUpsellDto) {
    return this.service.acceptUpsell(this.principal(req), dto);
  }

  @Post('pay')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiOperation({ summary: 'Pay deposit or outstanding balance during check-in' })
  pay(@Req() req: any, @Body() dto: GuestPayDto) {
    return this.service.pay(this.principal(req), dto);
  }

  @Post('self-check-in')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiOperation({ summary: 'Complete contactless self check-in when room is ready' })
  selfCheckIn(@Req() req: any) {
    return this.service.selfCheckIn(this.principal(req));
  }

  @Get('access')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiOperation({ summary: 'Room access: PIN, Wallet pass, mobile key' })
  access(@Req() req: any) {
    return this.service.getAccess(this.principal(req));
  }
}
