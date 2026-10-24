import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CheckInMagicGuard, type CheckInPrincipal } from './check-in-magic.guard';
import { GuestCheckInService } from './guest-check-in.service';
import {
  GuestAcceptUpsellDto,
  GuestPayDto,
  GuestPreRegisterDto,
  IssueCheckInLinkDto,
  RequestCheckInLinkDto,
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

  @Post('request-link')
  @Public()
  @ApiOperation({
    summary: 'Guest: request a new check-in link by confirmation number + email',
  })
  requestLink(@Body() dto: RequestCheckInLinkDto) {
    return this.service.requestLink(dto);
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

  @Post('worldline-tokenization')
  @Public()
  @UseGuards(CheckInMagicGuard)
  @ApiOperation({ summary: 'Start Worldline hosted card fields for check-in payment' })
  worldlineTokenization(@Req() req: any) {
    return this.service.createWorldlineTokenization(this.principal(req));
  }

  @Get('id-photo')
  @RequirePermissions('frontdesk.access')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'reservationId', required: true })
  @ApiOperation({ summary: 'Staff: whether guest uploaded an ID photo' })
  idPhoto(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('reservationId', ParseUUIDPipe) reservationId: string,
  ) {
    return this.service.getIdPhotoMeta(propertyId, reservationId);
  }

  @Get('id-photo/content')
  @RequirePermissions('frontdesk.access')
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'reservationId', required: true })
  @ApiOperation({ summary: 'Staff: download / preview guest ID photo bytes' })
  async idPhotoContent(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('reservationId', ParseUUIDPipe) reservationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.service.getIdPhotoContent(propertyId, reservationId);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(file.buffer);
  }
}
