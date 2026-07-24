import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import {
  CreateTurnawayDto,
  CreateTurnawayReasonCodeDto,
  ListTurnawaysDto,
} from './dto/turnaways.dto';
import { TurnawaysService } from './turnaways.service';

@ApiTags('turnaways')
@Controller()
export class TurnawaysController {
  constructor(private readonly turnawaysService: TurnawaysService) {}

  @Get('turnaway-reason-codes')
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'List turnaway reason codes for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  listReasonCodes(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.turnawaysService.listReasonCodes(propertyId);
  }

  @Post('turnaway-reason-codes')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Create a turnaway reason code for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  @HttpCode(HttpStatus.CREATED)
  createReasonCode(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateTurnawayReasonCodeDto,
  ) {
    return this.turnawaysService.createReasonCode(propertyId, dto);
  }

  @Post('turnaways')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Append a turnaway/regret capture record' })
  @ApiQuery({ name: 'propertyId', required: true })
  @HttpCode(HttpStatus.CREATED)
  createTurnaway(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateTurnawayDto,
  ) {
    return this.turnawaysService.create(propertyId, dto);
  }

  @Get('turnaways')
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'List turnaways/regrets for a date range' })
  list(@Query() dto: ListTurnawaysDto) {
    return this.turnawaysService.list(dto);
  }

  @Get('turnaways/summary')
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'Summarize turnaways/regrets by type and reason' })
  summary(@Query() dto: ListTurnawaysDto) {
    return this.turnawaysService.summary(dto);
  }
}
