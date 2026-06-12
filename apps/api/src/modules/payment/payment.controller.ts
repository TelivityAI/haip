import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { AuthorizePaymentDto } from './dto/authorize-payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { CorrectPaymentDto } from './dto/correct-payment.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Record payment (cash, bank transfer, etc.)' })
  @ApiResponse({ status: 201, description: 'Payment recorded' })
  recordPayment(@Body() dto: CreatePaymentDto) {
    return this.paymentService.recordPayment(dto);
  }

  @Post('authorize')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Authorize card payment (pre-auth)' })
  @ApiResponse({ status: 201, description: 'Payment authorized' })
  authorizePayment(@Body() dto: AuthorizePaymentDto) {
    return this.paymentService.authorizePayment(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payments with filters' })
  @ApiResponse({ status: 200, description: 'Paginated list of payments' })
  listPayments(@Query() dto: ListPaymentsDto) {
    return this.paymentService.list(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiResponse({ status: 200, description: 'Payment found' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getPaymentById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.paymentService.findById(id, propertyId);
  }

  @Post(':id/capture')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Capture authorized payment' })
  @ApiResponse({ status: 200, description: 'Payment captured' })
  @ApiQuery({ name: 'propertyId', type: String })
  capturePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.paymentService.capturePayment(id, propertyId);
  }

  @Post(':id/void')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Void authorized payment' })
  @ApiResponse({ status: 200, description: 'Payment voided' })
  @ApiQuery({ name: 'propertyId', type: String })
  voidPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.paymentService.voidPayment(id, propertyId);
  }

  @Post(':id/refund')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Refund captured payment' })
  @ApiResponse({ status: 200, description: 'Payment refunded' })
  @ApiQuery({ name: 'propertyId', type: String })
  refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: { amount?: string },
  ) {
    return this.paymentService.refundPayment(id, propertyId, body.amount);
  }

  @Post(':id/correct')
  @Roles('admin', 'front_desk')
  @ApiOperation({ summary: 'Correct a payment via the void/refund/adjust matrix (KB 14.1)' })
  @ApiResponse({ status: 200, description: 'Payment corrected' })
  correctPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectPaymentDto,
  ) {
    return this.paymentService.correctPayment(id, dto.propertyId, dto.op);
  }
}
