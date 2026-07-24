// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { housekeepingTasks, rooms, reservations, guests } from '@inhotel-io/database';
import { DRIZZLE } from '../../../database/database.module';
import { AgentService } from '../agent.service';
import type {
  HaipAgent,
  AgentContext,
  AgentAnalysis,
  AgentDecisionInput,
  AgentDecisionRecord,
  ExecutionResult,
  AgentOutcome,
  TrainingResult,
} from '../interfaces/haip-agent.interface';
import {
  assignRoomsToStaff,
  type RoomTask,
  type CleaningTimeConfig,
} from './housekeeping-optimizer.models';

@Injectable()
export class HousekeepingOptimizerAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'housekeeping';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const todayStr = new Date().toISOString().split('T')[0]!;
    const todayDate = new Date(todayStr);

    // Get pending/assigned tasks for today
    const tasks = await this.db
      .select({
        taskId: housekeepingTasks.id,
        roomId: housekeepingTasks.roomId,
        type: housekeepingTasks.type,
        status: housekeepingTasks.status,
        priority: housekeepingTasks.priority,
        serviceDate: housekeepingTasks.serviceDate,
      })
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.propertyId, propertyId),
          eq(housekeepingTasks.serviceDate, todayDate),
        ),
      );

    // Get room details for these tasks
    const roomIds = [...new Set(tasks.map((t: any) => t.roomId))];
    let roomDetails: any[] = [];
    if (roomIds.length > 0) {
      roomDetails = await this.db
        .select()
        .from(rooms)
        .where(eq(rooms.propertyId, propertyId));
    }
    const roomMap = new Map(roomDetails.map((r: any) => [r.id, r]));

    // Check for VIP/early check-in on incoming reservations
    const incoming = await this.db
      .select({
        roomId: reservations.roomId,
        guestId: reservations.guestId,
        arrivalDate: reservations.arrivalDate,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.arrivalDate, todayStr),
        ),
      );

    // Get guest VIP levels
    const guestIds = incoming.map((r: any) => r.guestId).filter(Boolean);
    let guestVip = new Map<string, string>();
    if (guestIds.length > 0) {
      const guestData = await this.db
        .select({ id: guests.id, vipLevel: guests.vipLevel })
        .from(guests);
      guestVip = new Map(guestData.map((g: any) => [g.id, g.vipLevel]));
    }

    // Build room→VIP map
    const vipRooms = new Set<string>();
    for (const res of incoming) {
      const vip = guestVip.get(res.guestId);
      if (vip && vip !== 'none') {
        vipRooms.add(res.roomId);
      }
    }

    const agentConfig = (config.config ?? {}) as Record<string, unknown>;

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        tasks,
        roomMap: Object.fromEntries(roomMap),
        vipRooms: [...vipRooms],
        staffCount: (agentConfig['staff_count'] as number) ?? 4,
        staffNames: (agentConfig['staff_names'] as string[]) ?? [],
        cleaningMinutes: agentConfig['cleaning_minutes'] as CleaningTimeConfig | undefined,
        priorityCheckoutFirst: (agentConfig['priority_checkout_first'] as boolean) ?? true,
        today: todayStr,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { tasks, roomMap, vipRooms, staffCount, staffNames, cleaningMinutes } =
      analysis.signals as any;

    // Filter to pending/assigned tasks only
    const actionable = tasks.filter(
      (t: any) => t.status === 'pending' || t.status === 'assigned',
    );

    if (actionable.length === 0) return [];

    // Build RoomTask list
    const roomTasks: RoomTask[] = actionable.map((t: any) => {
      const room = roomMap[t.roomId] ?? {};
      return {
        taskId: t.taskId,
        roomId: t.roomId,
        roomNumber: room.number ?? '',
        floor: room.floor ?? 1,
        building: room.building ?? '',
        roomTypeId: room.roomTypeId ?? '',
        taskType: t.type,
        priority: t.priority ?? 0,
        isVip: (vipRooms as string[]).includes(t.roomId),
        isEarlyCheckIn: false,
      };
    });

    // Generate staff IDs (if not configured, use generic IDs)
    const staffIds = Array.from({ length: staffCount }, (_, i) =>
      staffNames[i] ? `staff-${i}` : `staff-${i}`,
    );
    const names = Array.from({ length: staffCount }, (_, i) =>
      staffNames[i] ?? `Housekeeper ${i + 1}`,
    );

    const assignments = assignRoomsToStaff(roomTasks, staffIds, names, cleaningMinutes);

    return [
      {
        decisionType: 'housekeeping_assignment',
        recommendation: {
          assignments,
          summary: {
            totalTasks: actionable.length,
            staffCount,
            avgTasksPerStaff: Math.round(actionable.length / staffCount),
            estimatedCompletionRange: {
              earliest: assignments.reduce(
                (min, a) => (a.estimatedCompletionTime < min ? a.estimatedCompletionTime : min),
                '23:59',
              ),
              latest: assignments.reduce(
                (max, a) => (a.estimatedCompletionTime > max ? a.estimatedCompletionTime : max),
                '00:00',
              ),
            },
            vipRoomCount: roomTasks.filter((r) => r.isVip).length,
          },
        },
        confidence: 0.7,
        inputSnapshot: {
          taskCount: actionable.length,
          staffCount,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    return {
      success: true,
      changes: [{ entity: 'housekeeping', action: 'assigned', detail: 'AI assignment plan generated' }],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'housekeeping-optimizer-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      staff_count: 4,
      staff_names: [],
      cleaning_minutes: { standard: 30, suite: 45, stayover: 20, deep_clean: 60 },
      priority_checkout_first: true,
      group_by_floor: true,
      vip_priority: true,
      runScheduleCron: '0 8 * * *', // daily at 8am
    };
  }
}
