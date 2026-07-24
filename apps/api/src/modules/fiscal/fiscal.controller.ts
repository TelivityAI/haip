import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { SetFiscalConfigDto } from './dto/fiscal-config.dto';
import { FiscalService } from './fiscal.service';

@ApiTags('Fiscal')
@Controller('fiscal')
@Roles('admin')
export class FiscalController {
  constructor(private readonly fiscalService: FiscalService) {}

  @Get('config')
  @ApiOperation({ summary: 'Get fiscal and guest-registration provider config for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  getConfig(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.fiscalService.getConfig(propertyId);
  }

  @Put('config')
  @ApiOperation({ summary: 'Set fiscal and guest-registration provider config for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiBody({ type: SetFiscalConfigDto })
  setConfig(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: SetFiscalConfigDto,
  ) {
    return this.fiscalService.setConfig(propertyId, dto);
  }
}
