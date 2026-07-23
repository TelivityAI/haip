import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { doorLockCredentials, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import type { AccessCredential } from './lock-provider.interface';
import type { ListDoorLockCredentialsDto } from './dto/list-credentials.dto';

export interface RecordIssuedInput {
  propertyId: string;
  reservationId: string;
  roomId?: string | null;
  credential: AccessCredential;
}

@Injectable()
export class DoorLockCredentialService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async recordIssued(input: RecordIssuedInput) {
    const now = new Date();
    const values = {
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      roomId: input.roomId ?? null,
      provider: input.credential.provider,
      credentialId: input.credential.credentialId,
      accessCode: input.credential.accessCode ?? null,
      status: 'active' as const,
      issuedAt: now,
      revokedAt: null,
      updatedAt: now,
    };

    const [row] = await this.db
      .insert(doorLockCredentials)
      .values(values)
      .onConflictDoUpdate({
        target: [doorLockCredentials.propertyId, doorLockCredentials.reservationId],
        set: {
          roomId: values.roomId,
          provider: values.provider,
          credentialId: values.credentialId,
          accessCode: values.accessCode,
          status: 'active',
          issuedAt: now,
          revokedAt: null,
          updatedAt: now,
        },
      })
      .returning();

    return row;
  }

  async recordRevoked(propertyId: string, reservationId: string) {
    const now = new Date();
    const [row] = await this.db
      .update(doorLockCredentials)
      .set({
        status: 'revoked',
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(doorLockCredentials.propertyId, propertyId),
          eq(doorLockCredentials.reservationId, reservationId),
        ),
      )
      .returning();

    return row ?? null;
  }

  async findByReservation(reservationId: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(doorLockCredentials)
      .where(
        and(
          eq(doorLockCredentials.reservationId, reservationId),
          eq(doorLockCredentials.propertyId, propertyId),
        ),
      );

    if (!row) {
      throw new NotFoundException(`Door-lock credential for reservation ${reservationId} not found`);
    }

    return row;
  }

  async list(dto: ListDoorLockCredentialsDto) {
    const conditions = [eq(doorLockCredentials.propertyId, dto.propertyId)];
    if (dto.status) {
      conditions.push(eq(doorLockCredentials.status, dto.status));
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const offset = (page - 1) * limit;

    const rows = await this.db
      .select()
      .from(doorLockCredentials)
      .where(and(...conditions))
      .orderBy(desc(doorLockCredentials.issuedAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(doorLockCredentials)
      .where(and(...conditions));

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: Number(count),
        totalPages: Math.ceil(Number(count) / limit),
      },
    };
  }

  async getReservationRoom(propertyId: string, reservationId: string) {
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        roomId: reservations.roomId,
        status: reservations.status,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.propertyId, propertyId),
        ),
      );

    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    return reservation;
  }

  assertCanIssue(status: string) {
    const allowed = ['assigned', 'checked_in', 'stayover', 'due_out'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot issue door-lock credential for reservation in status "${status}"`,
      );
    }
  }
}
