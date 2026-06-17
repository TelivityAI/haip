import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { TaxService } from './tax.service';
import { CreateTaxProfileDto } from './dto/create-tax-profile.dto';
import { UpdateTaxProfileDto } from './dto/update-tax-profile.dto';
import { CreateTaxRuleDto } from './dto/create-tax-rule.dto';
import { UpdateTaxRuleDto } from './dto/update-tax-rule.dto';
import { CalculateTaxDto } from './dto/calculate-tax.dto';

@ApiTags('Tax')
@Controller('tax')
export class TaxController {
  constructor(private readonly taxService: TaxService) {}

  // --- Tax Profiles ---

  @Get('profiles')
  @ApiOperation({ summary: 'List tax profiles for a property' })
  listProfiles(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.taxService.listProfiles(propertyId);
  }

  @Post('profiles')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a tax profile' })
  createProfile(@Body() dto: CreateTaxProfileDto) {
    return this.taxService.createProfile(dto);
  }

  @Get('profiles/:id')
  @ApiOperation({ summary: 'Get tax profile with rules' })
  getProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.taxService.findProfileWithRules(id, propertyId);
  }

  @Patch('profiles/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a tax profile' })
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateTaxProfileDto,
  ) {
    return this.taxService.updateProfile(id, propertyId, dto);
  }

  // --- Tax Rules ---

  @Post('profiles/:profileId/rules')
  @Roles('admin')
  @ApiOperation({ summary: 'Add a tax rule to a profile' })
  createRule(
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateTaxRuleDto,
  ) {
    return this.taxService.createRule(profileId, propertyId, dto);
  }

  @Patch('profiles/:profileId/rules/:ruleId')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a tax rule' })
  updateRule(
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateTaxRuleDto,
  ) {
    return this.taxService.updateRule(ruleId, profileId, propertyId, dto);
  }

  @Delete('profiles/:profileId/rules/:ruleId')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a tax rule' })
  deleteRule(
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.taxService.deleteRule(ruleId, profileId, propertyId);
  }

  // --- Tax Calculation Preview ---

  @Post('calculate')
  @ApiOperation({ summary: 'Preview tax calculation (dry run, no posting)' })
  calculateTax(@Body() dto: CalculateTaxDto) {
    return this.taxService.calculateTaxes(
      dto.amount,
      dto.chargeType,
      dto.propertyId,
      dto.serviceDate,
      {
        guestId: dto.guestId,
        numberOfNights: dto.numberOfNights,
        nightNumber: dto.nightNumber,
      },
    );
  }
}
