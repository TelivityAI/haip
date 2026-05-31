import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { reservations, reservationNotes } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

/**
 * Reservation Notes (Tier 4 — Reservation Operations Polish).
 *
 * All reads/writes are tenant-scoped by propertyId. Mutations that target a
 * reservation first verify the parent reservation belongs to the property so a
 * caller cannot attach notes to another tenant's reservation.
 */
@Injectable()
export class ReservationNotesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  private async assertReservation(propertyId: string, reservationId: string) {
    const [reservation] = await this.db
      .select()
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

  async createNote(propertyId: string, reservationId: string, dto: CreateNoteDto) {
    await this.assertReservation(propertyId, reservationId);

    const [note] = await this.db
      .insert(reservationNotes)
      .values({
        propertyId,
        reservationId,
        body: dto.body,
        authorUserId: dto.authorUserId,
      })
      .returning();

    await this.webhookService.emit(
      'reservation.note_added',
      'reservation',
      reservationId,
      { reservationId, noteId: note.id },
      propertyId,
    );

    return note;
  }

  async listNotes(propertyId: string, reservationId: string) {
    await this.assertReservation(propertyId, reservationId);

    const notes = await this.db
      .select()
      .from(reservationNotes)
      .where(
        and(
          eq(reservationNotes.reservationId, reservationId),
          eq(reservationNotes.propertyId, propertyId),
        ),
      )
      .orderBy(reservationNotes.createdAt);

    const activeCount = notes.filter((n: any) => n.isActive).length;

    return { notes, activeCount };
  }

  async updateNote(id: string, propertyId: string, dto: UpdateNoteDto) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.body !== undefined) updates['body'] = dto.body;
    if (dto.isActive !== undefined) updates['isActive'] = dto.isActive;

    const [note] = await this.db
      .update(reservationNotes)
      .set(updates)
      .where(
        and(
          eq(reservationNotes.id, id),
          eq(reservationNotes.propertyId, propertyId),
        ),
      )
      .returning();

    if (!note) {
      throw new NotFoundException(`Note ${id} not found`);
    }
    return note;
  }

  async deleteNote(id: string, propertyId: string) {
    // Hard delete, tenant-scoped.
    const deleted = await this.db
      .delete(reservationNotes)
      .where(
        and(
          eq(reservationNotes.id, id),
          eq(reservationNotes.propertyId, propertyId),
        ),
      )
      .returning();

    if (!deleted || deleted.length === 0) {
      throw new NotFoundException(`Note ${id} not found`);
    }
    return { deleted: true, id };
  }
}
