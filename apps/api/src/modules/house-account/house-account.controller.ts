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
import { HouseAccountService } from './house-account.service';
import { OpenHouseAccountDto } from './dto/open-house-account.dto';
import { ListHouseAccountsDto } from './dto/list-house-accounts.dto';
import { AddHouseAccountChargeDto } from './dto/add-house-account-charge.dto';
import { AddHouseAccountPaymentDto } from './dto/add-house-account-payment.dto';
import { SellProductDto } from './dto/sell-product.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';

@ApiTags('house-accounts')
@Controller()
export class HouseAccountController {
  constructor(private readonly houseAccountService: HouseAccountService) {}

  // --- Products (retail catalog, KB 13.3) ---
  // Declared before :id house-account routes so '/products' is not shadowed.

  @Post('products')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Create a retail product (catalog item)' })
  @ApiResponse({ status: 201, description: 'Product created' })
  createProduct(@Body() dto: CreateProductDto) {
    return this.houseAccountService.createProduct(dto);
  }

  @Get('products')
  @ApiOperation({ summary: 'List retail products' })
  @ApiResponse({ status: 200, description: 'Paginated list of products' })
  listProducts(@Query() dto: ListProductsDto) {
    return this.houseAccountService.listProducts(dto);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiResponse({ status: 200, description: 'Product found' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.houseAccountService.findProductById(id, propertyId);
  }

  @Patch('products/:id')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Update a product' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiQuery({ name: 'propertyId', type: String })
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.houseAccountService.updateProduct(id, propertyId, dto);
  }

  // --- House accounts (KB 13) ---

  @Post('house-accounts')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Open a house account (KB 13.2)' })
  @ApiResponse({ status: 201, description: 'House account opened' })
  openHouseAccount(@Body() dto: OpenHouseAccountDto) {
    return this.houseAccountService.open(dto);
  }

  @Get('house-accounts')
  @ApiOperation({ summary: 'List house accounts' })
  @ApiResponse({ status: 200, description: 'Paginated list of house accounts' })
  listHouseAccounts(@Query() dto: ListHouseAccountsDto) {
    return this.houseAccountService.list(dto);
  }

  @Get('house-accounts/:id')
  @ApiOperation({ summary: 'Get house account by ID' })
  @ApiResponse({ status: 200, description: 'House account found' })
  @ApiResponse({ status: 404, description: 'House account not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getHouseAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.houseAccountService.findById(id, propertyId);
  }

  @Post('house-accounts/:id/close')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Close a house account (read-only after, KB 13.2)' })
  @ApiResponse({ status: 200, description: 'House account closed' })
  @ApiQuery({ name: 'propertyId', type: String })
  closeHouseAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.houseAccountService.close(id, propertyId);
  }

  @Post('house-accounts/:id/charges')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Post a charge to a house account' })
  @ApiResponse({ status: 201, description: 'Charge posted' })
  @ApiQuery({ name: 'propertyId', type: String })
  addCharge(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AddHouseAccountChargeDto,
  ) {
    return this.houseAccountService.addCharge(id, propertyId, dto);
  }

  @Post('house-accounts/:id/payments')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Record a payment on a house account' })
  @ApiResponse({ status: 201, description: 'Payment recorded' })
  @ApiQuery({ name: 'propertyId', type: String })
  addPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AddHouseAccountPaymentDto,
  ) {
    return this.houseAccountService.addPayment(id, propertyId, dto);
  }

  @Post('house-accounts/:id/sell')
  @Roles('admin', 'front_desk', 'night_auditor')
  @ApiOperation({ summary: 'Sell a catalog product to a house account (KB 13.3)' })
  @ApiResponse({ status: 201, description: 'Product sold; charge (and optional payment) posted' })
  @ApiQuery({ name: 'propertyId', type: String })
  sellProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: SellProductDto,
  ) {
    return this.houseAccountService.sellProduct(id, propertyId, dto);
  }
}
