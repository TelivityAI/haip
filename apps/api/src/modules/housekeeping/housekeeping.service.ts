import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq, and, sql, desc, asc, inArray, gte, lt } from 'drizzle-orm';
import { housekeepingTasks, rooms, reservations, guests, properties, roomTypes } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService, type WebhookPayload } from '../webhook/webhook.service';
import { RoomStatusService } from '../room/room-status.service';
import { type CreateTaskDto } from './dto/create-task.dto';
import { type UpdateTaskDto } from './dto/update-task.dto';
import { type ListTasksDto } from './dto/list-tasks.dto';
import { type AssignTaskDto } from './dto/assign-task.dto';
import { type AutoAssignDto } from './dto/auto-assign.dto';
import { type CompleteTaskDto } from './dto/complete-task.dto';
import { type InspectTaskDto } from './dto/inspect-task.dto';
import {
  CHECKLIST_TEMPLATES,
  ADA_EXTRA_ITEMS,
  VIP_EXTRA_ITEMS,
} from './checklist-templates';

@Injectable()
export class HousekeepingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly roomStatusService: RoomStatusService,
  ) {}

  async create(dto: CreateTaskDto) {
    let checklist = dto.checklist;

    if (!checklist) {
      checklist = await this.generateChecklist(dto.type, dto.roomId, dto.propertyId);
    }

    const [task] = await this.db
      .insert(housekeepingTasks)
      .values({
        propertyId: dto.propertyId,
        roomId: dto.roomId,
        type: dto.type,
        status: 'pending',
        priority: dto.priority ?? 0,
        // serviceDate arrives as a YYYY-MM-DD string; the column is a timestamp, so Drizzle
        // needs a Date (a raw string throws "value.toISOString is not a function").
        serviceDate: new Date(dto.serviceDate),
        notes: dto.notes,
        checklist,
      })
      .returning();

    return task;
  }

  async findById(id: string, propertyId: string) {
    const results = await this.db
      .select({
        task: housekeepingTasks,
        roomNumber: rooms.number,
        roomFloor: rooms.floor,
        roomBuilding: rooms.building,
      })
      .from(housekeepingTasks)
      .leftJoin(rooms, eq(housekeepingTasks.roomId, rooms.id))
      .where(
        and(
          eq(housekeepingTasks.id, id),
          eq(housekeepingTasks.propertyId, propertyId),
        ),
      );

    if (!results.length) {
      throw new NotFoundException(`Housekeeping task ${id} not found`);
    }

    const { task, roomNumber, roomFloor, roomBuilding } = results[0];
    return {
      ...task,
      room: { number: roomNumber, floor: roomFloor, building: roomBuilding },
    };
  }

  async list(dto: ListTasksDto) {
    const conditions: any[] = [
      eq(housekeepingTasks.propertyId, dto.propertyId),
    ];

    if (dto.status) conditions.push(eq(housekeepingTasks.status, dto.status as any));
    if (dto.type) conditions.push(eq(housekeepingTasks.type, dto.type as any));
    if (dto.assignedTo) conditions.push(eq(housekeepingTasks.assignedTo, dto.assignedTo));
    if (dto.serviceDate) {
      const dayStart = new Date(dto.serviceDate + 'T00:00:00');
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      conditions.push(gte(housekeepingTasks.serviceDate, dayStart));
      conditions.push(lt(housekeepingTasks.serviceDate, dayEnd));
    }
    if (dto.roomId) conditions.push(eq(housekeepingTasks.roomId, dto.roomId));

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [rows, countResult] = await Promise.all([
      this.db
        .select({
          task: housekeepingTasks,
          roomNumber: rooms.number,
        })
        .from(housekeepingTasks)
        .leftJoin(rooms, eq(housekeepingTasks.roomId, rooms.id))
        .where(whereClause)
        .orderBy(desc(housekeepingTasks.priority), asc(housekeepingTasks.serviceDate))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(housekeepingTasks)
        .where(whereClause),
    ]);

    const data = rows.map((r: any) => ({
      ...r.task,
      roomNumber: r.roomNumber,
    }));

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async update(id: string, propertyId: string, dto: UpdateTaskDto) {
    const task = await this.findByIdRaw(id, propertyId);

    if (task.status === 'completed' || task.status === 'inspected') {
      throw new BadRequestException(
        `Cannot update task in '${task.status}' status`,
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.priority !== undefined) updates['priority'] = dto.priority;
    if (dto.notes !== undefined) updates['notes'] = dto.notes;
    if (dto.maintenanceRequired !== undefined) updates['maintenanceRequired'] = dto.maintenanceRequired;
    if (dto.maintenanceNotes !== undefined) updates['maintenanceNotes'] = dto.maintenanceNotes;

    const [updated] = await this.db
      .update(housekeepingTasks)
      .set(updates)
      .where(
        and(
          eq(housekeepingTasks.id, id),
          eq(housekeepingTasks.propertyId, propertyId),
        ),
      )
      .returning();

    return updated;
  }

  async delete(id: string, propertyId: string) {
    const task = await this.findByIdRaw(id, propertyId);

    const nonDeletable = ['in_progress', 'completed', 'inspected'];
    if (nonDeletable.includes(task.status)) {
      throw new BadRequestException(
        `Cannot delete task in '${task.status}' status`,
      );
    }

    await this.db
      .delete(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.id, id),
          eq(housekeepingTasks.propertyId, propertyId),
        ),
      );

    return { deleted: true };
  }

  async assign(taskId: string, propertyId: string, dto: AssignTaskDto) {
    const task = await this.findByIdRaw(taskId, propertyId);

    if (task.status !== 'pending') {
      throw new BadRequestException(
        `Cannot assign task in '${task.status}' status — must be pending`,
      );
    }

    // Bug 5: atomic conditional claim. Two concurrent assigns both pass the
    // read-then-check above, but only one UPDATE with status='pending'
    // matches. The loser raises ConflictException with precise detail.
    const updated = await this.claimTaskTransition(
      taskId,
      propertyId,
      ['pending'],
      {
        assignedTo: dto.assignedTo,
        assignedAt: new Date(),
        status: 'assigned',
        updatedAt: new Date(),
      },
      'assigned',
    );

    await this.webhookService.emit(
      'housekeeping.task_assigned',
      'housekeeping_task',
      updated.id,
      { assignedTo: dto.assignedTo, roomId: task.roomId, type: task.type },
      propertyId,
    );

    return updated;
  }

  async startTask(taskId: string, propertyId: string) {
    const task = await this.findByIdRaw(taskId, propertyId);

    if (task.status !== 'assigned') {
      throw new BadRequestException(
        `Cannot start task in '${task.status}' status — must be assigned`,
      );
    }

    // Bug 5: atomic claim
    const updated = await this.claimTaskTransition(
      taskId,
      propertyId,
      ['assigned'],
      {
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      },
      'in_progress',
    );

    return updated;
  }

  async unassign(taskId: string, propertyId: string) {
    const task = await this.findByIdRaw(taskId, propertyId);

    if (task.status !== 'assigned') {
      throw new BadRequestException(
        `Cannot unassign task in '${task.status}' status — must be assigned`,
      );
    }

    // Bug 5: atomic claim
    const updated = await this.claimTaskTransition(
      taskId,
      propertyId,
      ['assigned'],
      {
        assignedTo: null,
        assignedAt: null,
        status: 'pending',
        updatedAt: new Date(),
      },
      'pending',
    );

    return updated;
  }

  async autoAssign(dto: AutoAssignDto) {
    // Get all pending tasks for this property + date, joined with rooms for sorting
    const tasks = await this.db
      .select({
        taskId: housekeepingTasks.id,
        priority: housekeepingTasks.priority,
        floor: rooms.floor,
        building: rooms.building,
      })
      .from(housekeepingTasks)
      .leftJoin(rooms, eq(housekeepingTasks.roomId, rooms.id))
      .where(
        and(
          eq(housekeepingTasks.propertyId, dto.propertyId),
          eq(housekeepingTasks.serviceDate, new Date(dto.serviceDate)),
          eq(housekeepingTasks.status, 'pending' as any),
        ),
      )
      .orderBy(
        desc(housekeepingTasks.priority),
        asc(rooms.floor),
        asc(rooms.building),
      );

    // Bug 5: each assign() now uses a conditional-update-by-status claim.
    // If another request claimed a task in between the SELECT above and the
    // UPDATE here (e.g. concurrent autoAssign or manual assign), the claim
    // fails and we simply skip that task rather than 500. Order: claim first,
    // webhook after — handled inside assign().
    let assigned = 0;
    for (let i = 0; i < tasks.length; i++) {
      const housekeeper = dto.housekeepers[i % dto.housekeepers.length]!;
      try {
        await this.assign(tasks[i]!.taskId, dto.propertyId, { assignedTo: housekeeper });
        assigned++;
      } catch (err: any) {
        // Task was already claimed by a concurrent caller, or transitioned
        // out of 'pending' between the select and the update — skip.
        if (err instanceof ConflictException || err instanceof BadRequestException) {
          continue;
        }
        throw err;
      }
    }

    return { assigned, total: tasks.length };
  }

  async completeTask(taskId: string, propertyId: string, dto: CompleteTaskDto = {}) {
    const task = await this.findByIdRaw(taskId, propertyId);

    if (task.status !== 'in_progress') {
      throw new BadRequestException(
        `Cannot complete task in '${task.status}' status — must be in_progress`,
      );
    }

    const updates: Record<string, unknown> = {
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    };
    if (dto.checklist) updates['checklist'] = dto.checklist;
    if (dto.notes !== undefined) updates['notes'] = dto.notes;
    if (dto.maintenanceRequired !== undefined) updates['maintenanceRequired'] = dto.maintenanceRequired;
    if (dto.maintenanceNotes !== undefined) updates['maintenanceNotes'] = dto.maintenanceNotes;

    // Check if property requires inspection (needed before claim so we know
    // which terminal status to set atomically)
    const [property] = await this.db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId));

    const requireInspection = (property?.settings as any)?.requireInspection ?? true;
    if (!requireInspection) {
      // Skip inspection — go straight to inspected
      updates['status'] = 'inspected';
      updates['inspectedAt'] = new Date();
    }

    // Bug 5: atomic claim FIRST — only a task still in_progress may
    // complete, and only one concurrent completion wins. Side effects
    // (room transitions, maintenance task, webhook) run after the claim.
    const updated = await this.claimTaskTransition(
      taskId,
      propertyId,
      ['in_progress'],
      updates,
      (updates['status'] as string),
    );

    // Transition room: vacant_dirty → clean (skip if already clean, e.g. after failed inspection)
    const roomStatus = await this.roomStatusService.getRoomStatus(task.roomId, propertyId);
    if (roomStatus.status === 'vacant_dirty') {
      await this.roomStatusService.transitionStatus(task.roomId, propertyId, 'clean');
    }

    if (!requireInspection) {
      await this.roomStatusService.transitionStatus(task.roomId, propertyId, 'inspected');
      await this.roomStatusService.transitionStatus(task.roomId, propertyId, 'guest_ready');
    }

    await this.webhookService.emit(
      'housekeeping.task_completed',
      'housekeeping_task',
      updated.id,
      { roomId: task.roomId, type: task.type, maintenanceRequired: dto.maintenanceRequired ?? false },
      propertyId,
    );

    // Auto-create maintenance task if flagged
    if (dto.maintenanceRequired) {
      await this.create({
        propertyId,
        roomId: task.roomId,
        type: 'maintenance',
        priority: 5,
        serviceDate: new Date().toISOString().split('T')[0]!,
        notes: dto.maintenanceNotes,
      });
    }

    return updated;
  }

  async inspectTask(taskId: string, propertyId: string, dto: InspectTaskDto) {
    const task = await this.findByIdRaw(taskId, propertyId);

    if (task.status !== 'completed') {
      throw new BadRequestException(
        `Cannot inspect task in '${task.status}' status — must be completed`,
      );
    }

    if (dto.passed) {
      const updates: Record<string, unknown> = {
        status: 'inspected',
        inspectedBy: dto.inspectedBy,
        inspectedAt: new Date(),
        updatedAt: new Date(),
      };
      if (dto.checklist) updates['checklist'] = dto.checklist;
      if (dto.notes !== undefined) updates['notes'] = dto.notes;

      // Bug 5: atomic claim from 'completed'
      const updated = await this.claimTaskTransition(
        taskId,
        propertyId,
        ['completed'],
        updates,
        'inspected',
      );

      // Transition room: clean → inspected → guest_ready
      await this.roomStatusService.transitionStatus(task.roomId, propertyId, 'inspected');
      await this.roomStatusService.transitionStatus(task.roomId, propertyId, 'guest_ready');

      return updated;
    }

    // Failed inspection — reset task for re-cleaning
    const updates: Record<string, unknown> = {
      status: 'pending',
      assignedTo: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      updatedAt: new Date(),
    };
    if (dto.notes) {
      updates['notes'] = `Inspector notes: ${dto.notes}${task.notes ? `\n${task.notes}` : ''}`;
    }

    // Bug 5: atomic claim from 'completed'
    const updated = await this.claimTaskTransition(
      taskId,
      propertyId,
      ['completed'],
      updates,
      'pending',
    );

    // Room stays at 'clean' — no transition (clean → vacant_dirty not valid)
    return updated;
  }

  async skipTask(taskId: string, propertyId: string, reason?: string) {
    const task = await this.findByIdRaw(taskId, propertyId);

    if (task.status !== 'pending' && task.status !== 'assigned') {
      throw new BadRequestException(
        `Cannot skip task in '${task.status}' status — must be pending or assigned`,
      );
    }

    // Bug 5: atomic claim — only pending/assigned can skip
    const updated = await this.claimTaskTransition(
      taskId,
      propertyId,
      ['pending', 'assigned'],
      {
        status: 'skipped',
        notes: reason ? `Skipped: ${reason}` : task.notes,
        updatedAt: new Date(),
      },
      'skipped',
    );

    return updated;
  }

  /**
   * Atomic state-machine transition for housekeeping tasks (Bug 5,
   * PR-A pattern). See ReservationService.claimTransition for rationale.
   */
  private async claimTaskTransition(
    taskId: string,
    propertyId: string,
    allowedFromStatuses: string[],
    updateData: Record<string, unknown>,
    targetStatus: string,
  ) {
    const statusCondition = allowedFromStatuses.length === 1
      ? eq(housekeepingTasks.status, allowedFromStatuses[0]! as any)
      : inArray(housekeepingTasks.status, allowedFromStatuses as any);

    const claimed = await this.db
      .update(housekeepingTasks)
      .set(updateData)
      .where(
        and(
          eq(housekeepingTasks.id, taskId),
          eq(housekeepingTasks.propertyId, propertyId),
          statusCondition,
        ),
      )
      .returning();

    if (claimed && claimed.length > 0) {
      return claimed[0];
    }

    const [current] = await this.db
      .select()
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.id, taskId),
          eq(housekeepingTasks.propertyId, propertyId),
        ),
      );
    if (!current) {
      throw new NotFoundException(`Housekeeping task ${taskId} not found`);
    }
    throw new ConflictException(
      `Cannot transition task from '${current.status}' to '${targetStatus}' ` +
      `(concurrent modification? expected one of: ${allowedFromStatuses.join(', ')})`,
    );
  }

  // propertyId is REQUIRED so the room/reservation reads below stay tenant-scoped:
  // roomId comes from the request body, so without an `eq(...propertyId)` filter a
  // caller at property A could pass a roomId from property B and leak that room's
  // ADA status / next-guest VIP level (cross-tenant IDOR).
  private async generateChecklist(taskType: string, roomId: string, propertyId: string) {
    const template = CHECKLIST_TEMPLATES[taskType];
    if (!template) return [];

    const items = template.map((item) => ({ ...item }));

    // Check if room is ADA accessible (scoped to the property)
    const [room] = await this.db
      .select({ isAccessible: rooms.isAccessible })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)));

    if (room?.isAccessible) {
      items.push(...ADA_EXTRA_ITEMS.map((item) => ({ ...item })));
    }

    // Check if next guest is VIP (scoped to the property)
    const [nextReservation] = await this.db
      .select({ vipLevel: guests.vipLevel })
      .from(reservations)
      .leftJoin(guests, eq(reservations.guestId, guests.id))
      .where(
        and(
          eq(reservations.roomId, roomId),
          eq(reservations.propertyId, propertyId),
          inArray(reservations.status, ['confirmed', 'assigned'] as any),
        ),
      )
      .orderBy(asc(reservations.arrivalDate))
      .limit(1);

    if (nextReservation?.vipLevel && nextReservation.vipLevel !== 'none') {
      items.push(...VIP_EXTRA_ITEMS.map((item) => ({ ...item })));
    }

    return items;
  }

  async getDashboard(propertyId: string, serviceDate: string) {
    // Room summary
    const roomSummaryRaw = await this.roomStatusService.getPropertyRoomSummary(propertyId);
    const roomSummary: Record<string, number> = {
      total: 0,
      vacant_clean: 0,
      vacant_dirty: 0,
      clean: 0,
      inspected: 0,
      guest_ready: 0,
      occupied: 0,
      out_of_order: 0,
      out_of_service: 0,
    };
    for (const row of roomSummaryRaw) {
      const count = Number(row.count);
      roomSummary[row.status] = count;
      roomSummary['total'] = (roomSummary['total'] ?? 0) + count;
    }

    // Task summary
    const taskSummaryRaw = await this.db
      .select({
        status: housekeepingTasks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.propertyId, propertyId),
          eq(housekeepingTasks.serviceDate, new Date(serviceDate)),
        ),
      )
      .groupBy(housekeepingTasks.status);

    const taskSummary: Record<string, number> = {
      total: 0, pending: 0, assigned: 0, in_progress: 0, completed: 0, inspected: 0, skipped: 0,
    };
    for (const row of taskSummaryRaw) {
      const count = Number(row.count);
      taskSummary[row.status] = count;
      taskSummary['total'] = (taskSummary['total'] ?? 0) + count;
    }

    // Housekeeper summary
    const housekeeperSummary = await this.db
      .select({
        housekeeperId: housekeepingTasks.assignedTo,
        tasksAssigned: sql<number>`count(*)::int`,
        tasksCompleted: sql<number>`count(*) filter (where ${housekeepingTasks.status} in ('completed', 'inspected'))::int`,
        tasksInProgress: sql<number>`count(*) filter (where ${housekeepingTasks.status} = 'in_progress')::int`,
        avgTurnTimeMinutes: sql<number>`avg(extract(epoch from (${housekeepingTasks.completedAt} - ${housekeepingTasks.startedAt})) / 60)`,
      })
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.propertyId, propertyId),
          eq(housekeepingTasks.serviceDate, new Date(serviceDate)),
          sql`${housekeepingTasks.assignedTo} is not null`,
        ),
      )
      .groupBy(housekeepingTasks.assignedTo);

    // Urgent rooms — high priority or maintenance flagged
    const urgentRooms = await this.db
      .select({
        roomId: housekeepingTasks.roomId,
        roomNumber: rooms.number,
        floor: rooms.floor,
        status: rooms.status,
        taskStatus: housekeepingTasks.status,
        priority: housekeepingTasks.priority,
        maintenanceRequired: housekeepingTasks.maintenanceRequired,
      })
      .from(housekeepingTasks)
      .leftJoin(rooms, eq(housekeepingTasks.roomId, rooms.id))
      .where(
        and(
          eq(housekeepingTasks.propertyId, propertyId),
          eq(housekeepingTasks.serviceDate, new Date(serviceDate)),
          sql`(${housekeepingTasks.priority} >= 5 or ${housekeepingTasks.maintenanceRequired} = true)`,
        ),
      )
      .orderBy(desc(housekeepingTasks.priority));

    return {
      date: serviceDate,
      roomSummary,
      taskSummary,
      housekeeperSummary: housekeeperSummary.map((h: any) => ({
        ...h,
        avgTurnTimeMinutes: h.avgTurnTimeMinutes ? Number(h.avgTurnTimeMinutes) : null,
      })),
      urgentRooms: urgentRooms.map((r: any) => ({
        roomId: r.roomId,
        roomNumber: r.roomNumber,
        floor: r.floor,
        status: r.status,
        taskStatus: r.taskStatus,
        priority: r.priority,
        reason: r.maintenanceRequired ? 'maintenance flagged' : 'high priority',
      })),
    };
  }

  async getAnalytics(propertyId: string, startDate: string, endDate: string) {
    const baseWhere = and(
      eq(housekeepingTasks.propertyId, propertyId),
      sql`${housekeepingTasks.serviceDate} >= ${startDate}`,
      sql`${housekeepingTasks.serviceDate} <= ${endDate}`,
      sql`${housekeepingTasks.status} in ('completed', 'inspected')`,
    );

    // Overall metrics
    const [metrics] = await this.db
      .select({
        avgTurnTimeMinutes: sql<number>`avg(extract(epoch from (${housekeepingTasks.completedAt} - ${housekeepingTasks.startedAt})) / 60)`,
        medianTurnTimeMinutes: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from (${housekeepingTasks.completedAt} - ${housekeepingTasks.startedAt})) / 60)`,
        totalTasksCompleted: sql<number>`count(*)::int`,
        maintenanceIssueCount: sql<number>`count(*) filter (where ${housekeepingTasks.maintenanceRequired} = true)::int`,
        inspectedCount: sql<number>`count(*) filter (where ${housekeepingTasks.status} = 'inspected')::int`,
      })
      .from(housekeepingTasks)
      .where(baseWhere);

    // Tasks by type
    const tasksByTypeRaw = await this.db
      .select({
        type: housekeepingTasks.type,
        count: sql<number>`count(*)::int`,
      })
      .from(housekeepingTasks)
      .where(baseWhere)
      .groupBy(housekeepingTasks.type);

    const tasksByType: Record<string, number> = {};
    for (const row of tasksByTypeRaw) {
      tasksByType[row.type] = Number(row.count);
    }

    // By room type
    const byRoomType = await this.db
      .select({
        roomTypeName: roomTypes.name,
        avgTurnTimeMinutes: sql<number>`avg(extract(epoch from (${housekeepingTasks.completedAt} - ${housekeepingTasks.startedAt})) / 60)`,
        taskCount: sql<number>`count(*)::int`,
      })
      .from(housekeepingTasks)
      .leftJoin(rooms, eq(housekeepingTasks.roomId, rooms.id))
      .leftJoin(roomTypes, eq(rooms.roomTypeId, roomTypes.id))
      .where(baseWhere)
      .groupBy(roomTypes.name);

    // By housekeeper
    const byHousekeeper = await this.db
      .select({
        housekeeperId: housekeepingTasks.assignedTo,
        tasksCompleted: sql<number>`count(*)::int`,
        avgTurnTimeMinutes: sql<number>`avg(extract(epoch from (${housekeepingTasks.completedAt} - ${housekeepingTasks.startedAt})) / 60)`,
      })
      .from(housekeepingTasks)
      .where(
        and(baseWhere, sql`${housekeepingTasks.assignedTo} is not null`),
      )
      .groupBy(housekeepingTasks.assignedTo);

    const total = Number(metrics.totalTasksCompleted ?? 0);
    const inspectionPassRate = total > 0 ? Number(metrics.inspectedCount ?? 0) / total : 0;
    const maintenanceIssueRate = total > 0 ? Number(metrics.maintenanceIssueCount ?? 0) / total : 0;

    // Distinct housekeepers
    const housekeeperCount = byHousekeeper.length || 1;

    return {
      period: { start: startDate, end: endDate },
      metrics: {
        avgTurnTimeMinutes: metrics.avgTurnTimeMinutes ? Number(metrics.avgTurnTimeMinutes) : 0,
        medianTurnTimeMinutes: metrics.medianTurnTimeMinutes ? Number(metrics.medianTurnTimeMinutes) : 0,
        totalTasksCompleted: total,
        tasksByType,
        inspectionPassRate,
        maintenanceIssueRate,
        avgTasksPerHousekeeper: total / housekeeperCount,
      },
      byRoomType: byRoomType.map((r: any) => ({
        roomTypeName: r.roomTypeName,
        avgTurnTimeMinutes: r.avgTurnTimeMinutes ? Number(r.avgTurnTimeMinutes) : 0,
        taskCount: Number(r.taskCount),
      })),
      byHousekeeper: byHousekeeper.map((h: any) => ({
        housekeeperId: h.housekeeperId,
        tasksCompleted: Number(h.tasksCompleted),
        avgTurnTimeMinutes: h.avgTurnTimeMinutes ? Number(h.avgTurnTimeMinutes) : 0,
      })),
    };
  }

  async generateStayoverTasks(propertyId: string, serviceDate: string) {
    const occupiedRooms = await this.roomStatusService.getRoomsByStatus(propertyId, 'occupied');

    let created = 0;
    let skipped = 0;

    for (const room of occupiedRooms) {
      // Check if a stayover task already exists for this room + date
      const [existing] = await this.db
        .select({ id: housekeepingTasks.id })
        .from(housekeepingTasks)
        .where(
          and(
            eq(housekeepingTasks.propertyId, propertyId),
            eq(housekeepingTasks.roomId, room.id),
            eq(housekeepingTasks.serviceDate, new Date(serviceDate)),
            eq(housekeepingTasks.type, 'stayover' as any),
          ),
        );

      if (existing) {
        skipped++;
        continue;
      }

      await this.create({
        propertyId,
        roomId: room.id,
        type: 'stayover',
        priority: 0,
        serviceDate,
      });
      created++;
    }

    return { created, skipped };
  }

  @OnEvent('room.status_changed')
  async handleRoomStatusChanged(payload: WebhookPayload) {
    if (payload.data['newStatus'] !== 'vacant_dirty') return;

    const propertyId = payload.propertyId!;
    const roomId = payload.entityId;

    // Bug 6: resolve the service date in the property's local timezone, not
    // server UTC. A 23:30 local checkout in America/Los_Angeles was landing
    // on tomorrow's UTC date and creating the task under the wrong day.
    const today = await this.getPropertyBusinessDate(propertyId);

    // Check for existing checkout task for this room + date to avoid duplicates
    const [existing] = await this.db
      .select({ id: housekeepingTasks.id })
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.propertyId, propertyId),
          eq(housekeepingTasks.roomId, roomId),
          eq(housekeepingTasks.serviceDate, new Date(today)),
          eq(housekeepingTasks.type, 'checkout' as any),
          sql`${housekeepingTasks.status} not in ('skipped', 'inspected')`,
        ),
      );

    if (existing) return;

    await this.create({
      propertyId,
      roomId,
      type: 'checkout',
      priority: 0,
      serviceDate: today,
    });
  }

  /**
   * Bug 6: compute today's business date (YYYY-MM-DD) in the property's
   * configured timezone rather than server UTC. Intl.DateTimeFormat + en-CA
   * gives ISO-ordered parts which we concatenate directly.
   */
  private async getPropertyBusinessDate(propertyId: string): Promise<string> {
    const [property] = await this.db
      .select({ timezone: properties.timezone })
      .from(properties)
      .where(eq(properties.id, propertyId));

    const tz = (property?.timezone as string | undefined) ?? 'UTC';
    try {
      // en-CA formats as YYYY-MM-DD natively
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      // Bad timezone on the property row — fall back to UTC rather than throw.
      return new Date().toISOString().split('T')[0]!;
    }
  }

  private async findByIdRaw(id: string, propertyId: string) {
    const [task] = await this.db
      .select()
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.id, id),
          eq(housekeepingTasks.propertyId, propertyId),
        ),
      );

    if (!task) {
      throw new NotFoundException(`Housekeeping task ${id} not found`);
    }

    return task;
  }
}
