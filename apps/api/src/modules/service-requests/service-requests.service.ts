import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { serviceRequests, rooms, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import {
  type CreateServiceRequestDto,
  type UpdateServiceRequestDto,
  type ListServiceRequestsDto,
  type CreateTaskFromRequestDto,
} from './dto/service-request.dto';

const HK_LINKABLE_TYPES = new Set([
  'maintenance',
  'turndown',
  'deep_clean',
  'checkout',
  'stayover',
  'inspection',
]);

@Injectable()
export class ServiceRequestsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly housekeepingService: HousekeepingService,
  ) {}

  private async verifyRoomOwnership(roomId: string, propertyId: string) {
    const [row] = await this.db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`room ${roomId} not found in this property`);
    }
  }

  private async verifyReservationOwnership(reservationId: string, propertyId: string) {
    const [row] = await this.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`reservation ${reservationId} not found in this property`);
    }
  }

  async create(dto: CreateServiceRequestDto) {
    if (dto.roomId) await this.verifyRoomOwnership(dto.roomId, dto.propertyId);
    if (dto.reservationId) await this.verifyReservationOwnership(dto.reservationId, dto.propertyId);

    const [request] = await this.db
      .insert(serviceRequests)
      .values({
        propertyId: dto.propertyId,
        roomId: dto.roomId,
        reservationId: dto.reservationId,
        type: dto.type,
        priority: dto.priority ?? 0,
        status: 'open',
        title: dto.title,
        description: dto.description,
        requestedBy: dto.requestedBy,
      })
      .returning();

    return request;
  }

  async list(dto: ListServiceRequestsDto) {
    const conditions = [eq(serviceRequests.propertyId, dto.propertyId)];
    if (dto.status) conditions.push(eq(serviceRequests.status, dto.status as any));
    if (dto.type) conditions.push(eq(serviceRequests.type, dto.type as any));

    return this.db
      .select()
      .from(serviceRequests)
      .where(and(...conditions))
      .orderBy(desc(serviceRequests.createdAt));
  }

  async findById(id: string, propertyId: string) {
    const [request] = await this.db
      .select()
      .from(serviceRequests)
      .where(and(eq(serviceRequests.id, id), eq(serviceRequests.propertyId, propertyId)));
    if (!request) {
      throw new NotFoundException(`Service request ${id} not found`);
    }
    return request;
  }

  async update(id: string, propertyId: string, dto: UpdateServiceRequestDto) {
    await this.findById(id, propertyId);

    if (dto.roomId) await this.verifyRoomOwnership(dto.roomId, propertyId);
    if (dto.reservationId) await this.verifyReservationOwnership(dto.reservationId, propertyId);

    const [request] = await this.db
      .update(serviceRequests)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(serviceRequests.id, id), eq(serviceRequests.propertyId, propertyId)))
      .returning();

    return request;
  }

  async delete(id: string, propertyId: string) {
    const [request] = await this.db
      .delete(serviceRequests)
      .where(and(eq(serviceRequests.id, id), eq(serviceRequests.propertyId, propertyId)))
      .returning();
    if (!request) {
      throw new NotFoundException(`Service request ${id} not found`);
    }
    return request;
  }

  async createLinkedTask(id: string, dto: CreateTaskFromRequestDto) {
    const request = await this.findById(id, dto.propertyId);

    if (request.linkedTaskId) {
      throw new ConflictException('Service request already has a linked housekeeping task');
    }
    if (!request.roomId) {
      throw new BadRequestException('Service request must have a room to create a housekeeping task');
    }

    const taskType = HK_LINKABLE_TYPES.has(request.type)
      ? request.type
      : 'maintenance';

    const serviceDate =
      dto.serviceDate ?? new Date().toISOString().slice(0, 10);

    const task = await this.housekeepingService.create({
      propertyId: dto.propertyId,
      roomId: request.roomId,
      type: taskType,
      priority: request.priority,
      serviceDate,
      notes: request.description ?? request.title,
    });

    const [updated] = await this.db
      .update(serviceRequests)
      .set({
        linkedTaskId: task.id,
        status: 'in_progress',
        updatedAt: new Date(),
      })
      .where(
        and(eq(serviceRequests.id, id), eq(serviceRequests.propertyId, dto.propertyId)),
      )
      .returning();

    return { request: updated, task };
  }
}
