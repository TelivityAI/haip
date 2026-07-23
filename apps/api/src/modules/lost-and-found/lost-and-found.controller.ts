import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { LostAndFoundService } from './lost-and-found.service';
import {
  CreateLostAndFoundItemDto,
  UpdateLostAndFoundItemDto,
  ListLostAndFoundItemsDto,
} from './dto/lost-and-found.dto';

@ApiTags('lost-and-found')
@Controller('lost-and-found')
export class LostAndFoundController {
  constructor(private readonly lostAndFoundService: LostAndFoundService) {}

  @Post()
  @Roles('admin', 'front_desk', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Log a lost-and-found item' })
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateLostAndFoundItemDto) {
    return this.lostAndFoundService.create(dto);
  }

  @Get()
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'List lost-and-found items' })
  list(@Query() dto: ListLostAndFoundItemsDto) {
    return this.lostAndFoundService.list(dto);
  }

  @Get(':id')
  @RequirePermissions('ops.read')
  @ApiOperation({ summary: 'Get lost-and-found item by ID' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.lostAndFoundService.findById(id, propertyId);
  }

  @Patch(':id')
  @Roles('admin', 'front_desk', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Update lost-and-found item' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateLostAndFoundItemDto,
  ) {
    return this.lostAndFoundService.update(id, propertyId, dto);
  }

  @Delete(':id')
  @Roles('admin', 'housekeeping_manager')
  @RequirePermissions('ops.manage')
  @ApiOperation({ summary: 'Delete lost-and-found item' })
  @ApiQuery({ name: 'propertyId', type: String, required: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.lostAndFoundService.delete(id, propertyId);
  }
}
