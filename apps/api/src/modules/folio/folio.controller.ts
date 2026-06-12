import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { FolioService } from './folio.service';
import { FolioRoutingService } from './folio-routing.service';
import { CreateFolioDto } from './dto/create-folio.dto';
import { UpdateFolioDto } from './dto/update-folio.dto';
import { ListFoliosDto } from './dto/list-folios.dto';
import { TransferChargeDto } from './dto/transfer-charge.dto';
import { TransferCityLedgerDto } from './dto/transfer-city-ledger.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { ListChargesDto } from './dto/list-charges.dto';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { MoveTransactionsDto } from './dto/move-transactions.dto';

@ApiTags('folios')
@Controller('folios')
export class FolioController {
  constructor(
    private readonly folioService: FolioService,
    private readonly folioRoutingService: FolioRoutingService,
  ) {}

  // --- Split-folio routing rules (KB 14.2) ---
  // Declared before :id routes so the static 'routing-rules' path is not
  // captured by the ':id' parameter.

  @Post('routing-rules')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Create a split-folio routing rule (KB 14.2)' })
  @ApiResponse({ status: 201, description: 'Routing rule created' })
  createRoutingRule(@Body() dto: CreateRoutingRuleDto) {
    return this.folioRoutingService.createRoutingRule(dto.propertyId, dto);
  }

  @Get('routing-rules')
  @ApiOperation({ summary: 'List split-folio routing rules for a reservation' })
  @ApiResponse({ status: 200, description: 'Routing rules' })
  @ApiQuery({ name: 'propertyId', type: String })
  @ApiQuery({ name: 'reservationId', type: String })
  listRoutingRules(
    @Query('reservationId', ParseUUIDPipe) reservationId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.folioRoutingService.listRoutingRules(reservationId, propertyId);
  }

  @Post()
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Create a folio' })
  @ApiResponse({ status: 201, description: 'Folio created' })
  createFolio(@Body() dto: CreateFolioDto) {
    return this.folioService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List folios with filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of folios' })
  listFolios(@Query() dto: ListFoliosDto) {
    return this.folioService.list(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get folio by ID' })
  @ApiResponse({ status: 200, description: 'Folio found' })
  @ApiResponse({ status: 404, description: 'Folio not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getFolioById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.folioService.findById(id, propertyId);
  }

  @Patch(':id')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Update folio' })
  @ApiResponse({ status: 200, description: 'Folio updated' })
  @ApiResponse({ status: 404, description: 'Folio not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  updateFolio(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateFolioDto,
  ) {
    return this.folioService.update(id, propertyId, dto);
  }

  @Patch(':id/settle')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Settle folio (balance must be zero)' })
  @ApiResponse({ status: 200, description: 'Folio settled' })
  @ApiQuery({ name: 'propertyId', type: String })
  settleFolio(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.folioService.settle(id, propertyId);
  }

  @Patch(':id/close')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Close folio (must be settled first)' })
  @ApiResponse({ status: 200, description: 'Folio closed' })
  @ApiQuery({ name: 'propertyId', type: String })
  closeFolio(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.folioService.close(id, propertyId);
  }

  @Post(':id/charges')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Post charge to folio' })
  @ApiResponse({ status: 201, description: 'Charge posted' })
  postCharge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChargeDto,
  ) {
    return this.folioService.postCharge(id, dto);
  }

  @Get(':id/charges')
  @ApiOperation({ summary: 'List charges on folio' })
  @ApiResponse({ status: 200, description: 'Paginated list of charges' })
  getCharges(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() dto: ListChargesDto,
  ) {
    return this.folioService.getCharges(id, dto);
  }

  @Post(':id/charges/:chargeId/reverse')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Reverse a charge' })
  @ApiResponse({ status: 200, description: 'Charge reversed' })
  @ApiQuery({ name: 'propertyId', type: String })
  reverseCharge(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.folioService.reverseCharge(id, chargeId, propertyId);
  }

  @Post(':id/charges/lock')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Lock charges up to audit date' })
  @ApiResponse({ status: 200, description: 'Charges locked' })
  @ApiQuery({ name: 'propertyId', type: String })
  lockCharges(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: { auditDate: string },
  ) {
    return this.folioService.lockCharges(id, propertyId, new Date(body.auditDate));
  }

  @Post(':id/transfer-charge')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Transfer charge to another folio' })
  @ApiResponse({ status: 200, description: 'Charge transferred' })
  @ApiQuery({ name: 'propertyId', type: String })
  transferCharge(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: TransferChargeDto,
  ) {
    return this.folioService.transferCharge(id, propertyId, dto);
  }

  @Post(':id/move-transactions')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Move transactions to another folio (KB 14.2)' })
  @ApiResponse({ status: 200, description: 'Transactions moved' })
  @ApiQuery({ name: 'propertyId', type: String })
  moveTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: MoveTransactionsDto,
  ) {
    return this.folioRoutingService.moveTransactions(propertyId, id, dto.toFolioId, {
      chargeId: dto.chargeId,
      chargeType: dto.chargeType,
    });
  }

  @Post(':id/transfer-to-city-ledger')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Transfer outstanding balance to city ledger' })
  @ApiResponse({ status: 200, description: 'Balance transferred to city ledger' })
  @ApiQuery({ name: 'propertyId', type: String })
  transferToCityLedger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: TransferCityLedgerDto,
  ) {
    return this.folioRoutingService.transferToCityLedger(id, propertyId, dto);
  }
}
