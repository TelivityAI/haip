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
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { HousekeepingService } from './housekeeping.service';
import { RoomService } from '../room/room.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { AutoAssignDto } from './dto/auto-assign.dto';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { InspectTaskDto } from './dto/inspect-task.dto';

@ApiTags('housekeeping')
@Controller('housekeeping')
export class HousekeepingController {
  constructor(
    private readonly housekeepingService: HousekeepingService,
    private readonly roomService: RoomService,
  ) {}

  @Get('/dashboard')
  @RequirePermissions('housekeeping.read')
  @ApiOperation({ summary: 'Get housekeeping dashboard' })
  @ApiQuery({ name: 'propertyId', type: String })
  @ApiQuery({ name: 'serviceDate', type: String })
  getDashboard(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('serviceDate') serviceDate: string,
  ) {
    return this.housekeepingService.getDashboard(propertyId, serviceDate);
  }

  @Get('/analytics')
  @RequirePermissions('housekeeping.read')
  @ApiOperation({ summary: 'Get housekeeping analytics' })
  @ApiQuery({ name: 'propertyId', type: String })
  @ApiQuery({ name: 'startDate', type: String })
  @ApiQuery({ name: 'endDate', type: String })
  getAnalytics(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.housekeepingService.getAnalytics(propertyId, startDate, endDate);
  }

  @Post('/generate-stayover-tasks')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Generate stayover tasks for occupied rooms' })
  generateStayoverTasks(
    @Body() body: { propertyId: string; serviceDate: string },
  ) {
    return this.housekeepingService.generateStayoverTasks(body.propertyId, body.serviceDate);
  }

  @Post('/auto-assign')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Auto-assign pending tasks to housekeepers' })
  autoAssign(@Body() dto: AutoAssignDto) {
    return this.housekeepingService.autoAssign(dto);
  }

  @Post('/tasks')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Create housekeeping task' })
  @HttpCode(HttpStatus.CREATED)
  async createTask(@Body() dto: CreateTaskDto) {
    // roomId is client-supplied — verify it belongs to the request's property (throws
    // NotFound otherwise) so a caller can't attach a task to another tenant's room.
    await this.roomService.findRoomById(dto.roomId, dto.propertyId);
    return this.housekeepingService.create(dto);
  }

  @Get('/tasks')
  @RequirePermissions('housekeeping.read')
  @ApiOperation({ summary: 'List housekeeping tasks' })
  listTasks(@Query() dto: ListTasksDto) {
    return this.housekeepingService.list(dto);
  }

  @Get('/tasks/:id')
  @RequirePermissions('housekeeping.read')
  @ApiOperation({ summary: 'Get housekeeping task by ID' })
  @ApiQuery({ name: 'propertyId', type: String })
  getTaskById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.housekeepingService.findById(id, propertyId);
  }

  @Patch('/tasks/:id/assign')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Assign task to housekeeper' })
  @ApiQuery({ name: 'propertyId', type: String })
  assignTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.housekeepingService.assign(id, propertyId, dto);
  }

  @Patch('/tasks/:id/start')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Start assigned task' })
  @ApiQuery({ name: 'propertyId', type: String })
  startTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.housekeepingService.startTask(id, propertyId);
  }

  @Patch('/tasks/:id/unassign')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Unassign task' })
  @ApiQuery({ name: 'propertyId', type: String })
  unassignTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.housekeepingService.unassign(id, propertyId);
  }

  @Patch('/tasks/:id/complete')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Complete housekeeping task' })
  @ApiQuery({ name: 'propertyId', type: String })
  completeTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CompleteTaskDto,
  ) {
    return this.housekeepingService.completeTask(id, propertyId, dto);
  }

  @Patch('/tasks/:id/inspect')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Inspect completed task' })
  @ApiQuery({ name: 'propertyId', type: String })
  inspectTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: InspectTaskDto,
  ) {
    return this.housekeepingService.inspectTask(id, propertyId, dto);
  }

  @Patch('/tasks/:id/skip')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Skip housekeeping task' })
  @ApiQuery({ name: 'propertyId', type: String })
  skipTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() body: { reason?: string },
  ) {
    return this.housekeepingService.skipTask(id, propertyId, body.reason);
  }

  @Patch('/tasks/:id')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Update housekeeping task' })
  @ApiQuery({ name: 'propertyId', type: String })
  updateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.housekeepingService.update(id, propertyId, dto);
  }

  @Delete('/tasks/:id')
  @Roles('admin', 'housekeeping', 'housekeeping_manager')
  @RequirePermissions('housekeeping.manage')
  @ApiOperation({ summary: 'Delete housekeeping task' })
  @ApiQuery({ name: 'propertyId', type: String })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.housekeepingService.delete(id, propertyId);
  }
}
