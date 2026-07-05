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
import { DepositService } from './deposit.service';
import { ArService } from './ar.service';
import { AccountingCodeService } from './accounting-code.service';
import { RecordDepositDto } from './dto/record-deposit.dto';
import { ListDepositsDto } from './dto/list-deposits.dto';
import { ApplyDepositDto } from './dto/apply-deposit.dto';
import { CreateArLedgerDto } from './dto/create-ar-ledger.dto';
import { UpdateArLedgerDto } from './dto/update-ar-ledger.dto';
import { ListArLedgersDto } from './dto/list-ar-ledgers.dto';
import { TransferToArDto } from './dto/transfer-to-ar.dto';
import { RecordArPaymentDto } from './dto/record-ar-payment.dto';
import { CreateAccountingCodeDto } from './dto/create-accounting-code.dto';
import { UpdateAccountingCodeDto } from './dto/update-accounting-code.dto';
import { ListAccountingCodesDto } from './dto/list-accounting-codes.dto';

@ApiTags('accounting')
@Controller()
export class AccountingController {
  constructor(
    private readonly depositService: DepositService,
    private readonly arService: ArService,
    private readonly accountingCodeService: AccountingCodeService,
  ) {}

  @Get('accounting')
  @ApiOperation({ summary: 'Accounting API namespace' })
  @ApiResponse({ status: 200, description: 'Available accounting endpoints' })
  accountingIndex() {
    return { endpoints: ['deposits', 'ar/ledgers', 'accounting/codes'] };
  }

  // --- Deposit Ledger (KB 10) ---

  @Post('deposits')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Record an advance deposit (held liability)' })
  @ApiResponse({ status: 201, description: 'Deposit recorded' })
  recordDeposit(@Body() dto: RecordDepositDto) {
    return this.depositService.recordDeposit(dto);
  }

  @Get('deposits')
  @ApiOperation({ summary: 'List deposit ledger entries' })
  @ApiResponse({ status: 200, description: 'Paginated list of deposits' })
  listDeposits(@Query() dto: ListDepositsDto) {
    return this.depositService.list(dto);
  }

  @Get('deposits/:id')
  @ApiOperation({ summary: 'Get deposit by ID' })
  @ApiResponse({ status: 200, description: 'Deposit found' })
  @ApiResponse({ status: 404, description: 'Deposit not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getDeposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.depositService.findById(id, propertyId);
  }

  @Post('deposits/:id/apply')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Apply a held deposit to a folio (KB 10.3)' })
  @ApiResponse({ status: 200, description: 'Deposit applied' })
  applyDeposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyDepositDto,
  ) {
    return this.depositService.applyDeposit(id, dto);
  }

  @Post('deposits/:id/refund')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Refund a held refundable deposit (KB 10.4)' })
  @ApiResponse({ status: 200, description: 'Deposit refunded' })
  @ApiQuery({ name: 'propertyId', type: String })
  refundDeposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.depositService.refundDeposit(id, propertyId);
  }

  @Post('deposits/:id/forfeit')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Forfeit a held deposit as earned revenue (KB 10.4)' })
  @ApiResponse({ status: 200, description: 'Deposit forfeited' })
  @ApiQuery({ name: 'propertyId', type: String })
  forfeitDeposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.depositService.forfeitDeposit(id, propertyId);
  }

  // --- Accounts Receivable (KB 11) ---

  @Post('ar/ledgers')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Create an A/R ledger' })
  @ApiResponse({ status: 201, description: 'A/R ledger created' })
  createArLedger(@Body() dto: CreateArLedgerDto) {
    return this.arService.createLedger(dto);
  }

  @Get('ar/ledgers')
  @ApiOperation({ summary: 'List A/R ledgers' })
  @ApiResponse({ status: 200, description: 'Paginated list of A/R ledgers' })
  listArLedgers(@Query() dto: ListArLedgersDto) {
    return this.arService.listLedgers(dto);
  }

  @Get('ar/ledgers/:id')
  @ApiOperation({ summary: 'Get A/R ledger by ID' })
  @ApiResponse({ status: 200, description: 'A/R ledger found' })
  @ApiResponse({ status: 404, description: 'A/R ledger not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getArLedger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.arService.findLedgerById(id, propertyId);
  }

  @Patch('ar/ledgers/:id')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Update an A/R ledger' })
  @ApiResponse({ status: 200, description: 'A/R ledger updated' })
  @ApiQuery({ name: 'propertyId', type: String })
  updateArLedger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateArLedgerDto,
  ) {
    return this.arService.updateLedger(id, propertyId, dto);
  }

  @Post('ar/ledgers/:id/close')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Close an A/R ledger (KB 11.2)' })
  @ApiResponse({ status: 200, description: 'A/R ledger closed' })
  @ApiQuery({ name: 'propertyId', type: String })
  closeArLedger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.arService.closeLedger(id, propertyId);
  }

  @Post('ar/transfer')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Transfer an outstanding folio balance into an A/R ledger (KB 11.3)' })
  @ApiResponse({ status: 201, description: 'Balance transferred to A/R' })
  transferToAr(@Body() dto: TransferToArDto) {
    return this.arService.transferFolioToAR(dto);
  }

  @Post('ar/transactions/:id/reverse')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Reverse an A/R transfer (KB 11.4)' })
  @ApiResponse({ status: 200, description: 'Transfer reversed' })
  @ApiQuery({ name: 'propertyId', type: String })
  reverseArTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.arService.reverseTransfer(id, propertyId);
  }

  @Post('ar/ledgers/:id/payments')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Record a payment against an A/R ledger (KB 11.5)' })
  @ApiResponse({ status: 201, description: 'A/R payment recorded' })
  recordArPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordArPaymentDto,
  ) {
    return this.arService.recordARPayment(id, dto);
  }

  @Get('ar/ledgers/:id/aging')
  @ApiOperation({ summary: 'Aging report for an A/R ledger (KB 11.5)' })
  @ApiResponse({ status: 200, description: 'Aging buckets' })
  @ApiQuery({ name: 'propertyId', type: String })
  arAging(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.arService.aging(propertyId, id);
  }

  // --- Custom Accounting / GL Codes (KB 5) ---

  @Post('accounting/codes')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Create a custom accounting / GL code' })
  @ApiResponse({ status: 201, description: 'Accounting code created' })
  createAccountingCode(@Body() dto: CreateAccountingCodeDto) {
    return this.accountingCodeService.create(dto);
  }

  @Get('accounting/codes')
  @ApiOperation({ summary: 'List accounting / GL codes' })
  @ApiResponse({ status: 200, description: 'Paginated list of accounting codes' })
  listAccountingCodes(@Query() dto: ListAccountingCodesDto) {
    return this.accountingCodeService.list(dto);
  }

  @Get('accounting/codes/:id')
  @ApiOperation({ summary: 'Get accounting code by ID' })
  @ApiResponse({ status: 200, description: 'Accounting code found' })
  @ApiResponse({ status: 404, description: 'Accounting code not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getAccountingCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.accountingCodeService.findById(id, propertyId);
  }

  @Patch('accounting/codes/:id')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Update an accounting code' })
  @ApiResponse({ status: 200, description: 'Accounting code updated' })
  @ApiQuery({ name: 'propertyId', type: String })
  updateAccountingCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateAccountingCodeDto,
  ) {
    return this.accountingCodeService.update(id, propertyId, dto);
  }

  @Post('accounting/codes/:id/archive')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Archive an accounting code (soft delete)' })
  @ApiResponse({ status: 200, description: 'Accounting code archived' })
  @ApiQuery({ name: 'propertyId', type: String })
  archiveAccountingCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.accountingCodeService.archive(id, propertyId);
  }
}
