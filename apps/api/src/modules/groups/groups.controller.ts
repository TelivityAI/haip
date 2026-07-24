import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { GroupProfileService } from './group-profile.service';
import { AllotmentService } from './allotment.service';
import { RoomingListService } from './rooming-list.service';
import { CreateGroupProfileDto } from './dto/create-group-profile.dto';
import { UpdateGroupProfileDto } from './dto/update-group-profile.dto';
import { ListGroupProfilesDto } from './dto/list-group-profiles.dto';
import { LinkReservationDto } from './dto/link-reservation.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { ListBlocksDto } from './dto/list-blocks.dto';
import { SetInventoryDto } from './dto/set-inventory.dto';
import { ImportRoomingListDto } from './dto/import-rooming-list.dto';

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupProfileService: GroupProfileService,
    private readonly allotmentService: AllotmentService,
    private readonly roomingListService: RoomingListService,
  ) {}

  // --- Group profiles (KB 14.3) ---

  @Post('profiles')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Create a group profile (KB 14.3)' })
  @ApiResponse({ status: 201, description: 'Group profile created' })
  createProfile(@Body() dto: CreateGroupProfileDto) {
    return this.groupProfileService.createProfile(dto);
  }

  @Get('profiles')
  @ApiOperation({ summary: 'List group profiles' })
  @ApiResponse({ status: 200, description: 'Paginated list of group profiles' })
  listProfiles(@Query() dto: ListGroupProfilesDto) {
    return this.groupProfileService.listProfiles(dto);
  }

  @Get('profiles/:id')
  @ApiOperation({ summary: 'Get group profile by ID' })
  @ApiResponse({ status: 200, description: 'Group profile found' })
  @ApiResponse({ status: 404, description: 'Group profile not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getProfileById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.groupProfileService.findProfileById(id, propertyId);
  }

  @Get('profiles/:id/commercial')
  @ApiOperation({
    summary: 'Commercial links for a group profile (A/R ledgers + negotiated rates)',
  })
  @ApiResponse({ status: 200, description: 'Profile with linked A/R and rate plans' })
  @ApiQuery({ name: 'propertyId', type: String })
  getCommercialLinks(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.groupProfileService.getCommercialLinks(id, propertyId);
  }

  @Patch('profiles/:id')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Update a group profile' })
  @ApiResponse({ status: 200, description: 'Group profile updated' })
  @ApiQuery({ name: 'propertyId', type: String })
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateGroupProfileDto,
  ) {
    return this.groupProfileService.updateProfile(id, propertyId, dto);
  }

  @Post('profiles/:id/reservations')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Link a member reservation to a group profile (KB 14.3)' })
  @ApiResponse({ status: 201, description: 'Reservation linked' })
  linkReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkReservationDto,
  ) {
    return this.groupProfileService.linkReservation(id, dto.propertyId, dto.reservationId);
  }

  @Get('profiles/:id/folio')
  @ApiOperation({ summary: 'Get the master/group folio for a profile (KB 14.7)' })
  @ApiResponse({ status: 200, description: 'Master folio' })
  @ApiResponse({ status: 404, description: 'No master folio' })
  @ApiQuery({ name: 'propertyId', type: String })
  getGroupFolio(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.groupProfileService.getGroupFolio(id, propertyId);
  }

  @Post('profiles/:id/invoice')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Generate a group invoice from the master folio (KB 14.7)' })
  @ApiResponse({ status: 201, description: 'Group invoice generated' })
  @ApiQuery({ name: 'propertyId', type: String })
  generateInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.groupProfileService.generateGroupInvoice(id, propertyId);
  }

  // --- Allotment blocks (KB 14.4–14.5) ---
  // Static sub-paths declared before ':id' so they are not captured by the param.

  @Post('blocks')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Create an allotment block (KB 14.4)' })
  @ApiResponse({ status: 201, description: 'Block created' })
  createBlock(@Body() dto: CreateBlockDto) {
    return this.allotmentService.createBlock(dto);
  }

  @Get('blocks')
  @ApiOperation({ summary: 'List allotment blocks' })
  @ApiResponse({ status: 200, description: 'Paginated list of blocks' })
  listBlocks(@Query() dto: ListBlocksDto) {
    return this.allotmentService.listBlocks(dto);
  }

  @Post('blocks/process-cutoffs')
  @Roles('admin', 'night_auditor', 'revenue_manager')
  @ApiOperation({
    summary: 'Release all auto-release blocks past cutoff (KB 14.4)',
    description: 'Called by an external scheduler / night audit — no in-process cron.',
  })
  @ApiResponse({ status: 201, description: 'Cutoff sweep result' })
  @ApiQuery({ name: 'propertyId', type: String })
  processCutoffs(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.allotmentService.processCutoffs(propertyId);
  }

  @Get('blocks/:id')
  @ApiOperation({ summary: 'Get allotment block by ID' })
  @ApiResponse({ status: 200, description: 'Block found' })
  @ApiResponse({ status: 404, description: 'Block not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  getBlockById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.allotmentService.findBlockById(id, propertyId);
  }

  @Patch('blocks/:id')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Update an allotment block' })
  @ApiResponse({ status: 200, description: 'Block updated' })
  @ApiQuery({ name: 'propertyId', type: String })
  updateBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateBlockDto,
  ) {
    return this.allotmentService.updateBlock(id, propertyId, dto);
  }

  @Put('blocks/:id/inventory')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Set held inventory for a date/room-type (KB 14.5)' })
  @ApiResponse({ status: 200, description: 'Inventory upserted' })
  @ApiResponse({ status: 400, description: 'Over-allotment beyond sellable availability' })
  setInventory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetInventoryDto,
  ) {
    return this.allotmentService.setInventory(id, dto.propertyId, dto);
  }

  @Get('blocks/:id/pickup')
  @ApiOperation({ summary: 'Pickup report — allotted vs picked up (KB 14.5)' })
  @ApiResponse({ status: 200, description: 'Pickup report' })
  @ApiQuery({ name: 'propertyId', type: String })
  getPickup(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.allotmentService.getPickup(id, propertyId);
  }

  @Post('blocks/:id/release')
  @Roles('admin', 'front_desk', 'night_auditor', 'revenue_manager')
  @ApiOperation({ summary: 'Release a block — return unpicked rooms to general inventory (KB 14.4)' })
  @ApiResponse({ status: 201, description: 'Block released' })
  @ApiQuery({ name: 'propertyId', type: String })
  releaseBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.allotmentService.releaseBlock(id, propertyId);
  }

  @Get('blocks/:id/rooming-list')
  @ApiOperation({ summary: 'List rooming-list entries for a block (KB 14.6)' })
  @ApiResponse({ status: 200, description: 'Rooming list entries' })
  @ApiResponse({ status: 404, description: 'Block not found' })
  @ApiQuery({ name: 'propertyId', type: String })
  listRoomingList(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.roomingListService.listEntries(id, propertyId);
  }

  @Post('blocks/:id/rooming-list')
  @Roles('admin', 'front_desk', 'revenue_manager')
  @ApiOperation({ summary: 'Import a rooming list to create member reservations (KB 14.6)' })
  @ApiResponse({ status: 201, description: 'Rooming list import result' })
  importRoomingList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportRoomingListDto,
  ) {
    return this.roomingListService.importRoomingList(id, dto.propertyId, dto);
  }
}
