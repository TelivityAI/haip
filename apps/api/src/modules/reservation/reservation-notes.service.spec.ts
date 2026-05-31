import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReservationNotesService } from './reservation-notes.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockReservation = { id: 'res-001', propertyId: 'prop-001' };
const mockNote = {
  id: 'note-001',
  propertyId: 'prop-001',
  reservationId: 'res-001',
  body: 'Guest requests late checkout',
  isActive: true,
  authorUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockWebhookService = { emit: vi.fn() };

// selectReturns is consumed in order: each .where() resolves the next array.
function createMockDb(opts: {
  selectReturns?: any[][];
  insertReturn?: any[];
  updateReturn?: any[];
  deleteReturn?: any[];
}) {
  const selects = [...(opts.selectReturns ?? [])];
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const next = selects.shift() ?? [];
          return {
            then: (resolve: any) => resolve(next),
            orderBy: vi.fn().mockResolvedValue(next),
          };
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(opts.insertReturn ?? [mockNote]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(opts.updateReturn ?? [mockNote]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(opts.deleteReturn ?? [mockNote]),
      }),
    }),
  };
}

async function createService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReservationNotesService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<ReservationNotesService>(ReservationNotesService);
}

describe('ReservationNotesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createNote inserts and emits reservation.note_added', async () => {
    const db = createMockDb({ selectReturns: [[mockReservation]] });
    const svc = await createService(db);

    const note = await svc.createNote('prop-001', 'res-001', { propertyId: 'prop-001', body: 'x' });

    expect(note.id).toBe('note-001');
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.note_added',
      'reservation',
      'res-001',
      expect.objectContaining({ noteId: 'note-001' }),
      'prop-001',
    );
  });

  it('createNote rejects when reservation not in property', async () => {
    const db = createMockDb({ selectReturns: [[]] });
    const svc = await createService(db);
    await expect(
      svc.createNote('prop-001', 'res-001', { propertyId: 'prop-001', body: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('listNotes returns notes and activeCount', async () => {
    const notes = [mockNote, { ...mockNote, id: 'note-002', isActive: false }];
    const db = createMockDb({ selectReturns: [[mockReservation], notes] });
    const svc = await createService(db);

    const result = await svc.listNotes('prop-001', 'res-001');
    expect(result.notes.length).toBe(2);
    expect(result.activeCount).toBe(1);
  });

  it('updateNote returns updated note', async () => {
    const db = createMockDb({ updateReturn: [{ ...mockNote, body: 'updated' }] });
    const svc = await createService(db);
    const note = await svc.updateNote('note-001', 'prop-001', { propertyId: 'prop-001', body: 'updated' });
    expect(note.body).toBe('updated');
  });

  it('updateNote throws when note not found (wrong tenant)', async () => {
    const db = createMockDb({ updateReturn: [] });
    const svc = await createService(db);
    await expect(
      svc.updateNote('note-001', 'prop-999', { propertyId: 'prop-999', isActive: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deleteNote hard-deletes scoped by propertyId', async () => {
    const db = createMockDb({ deleteReturn: [mockNote] });
    const svc = await createService(db);
    const result = await svc.deleteNote('note-001', 'prop-001');
    expect(result.deleted).toBe(true);
  });

  it('deleteNote throws when nothing deleted (wrong tenant)', async () => {
    const db = createMockDb({ deleteReturn: [] });
    const svc = await createService(db);
    await expect(svc.deleteNote('note-001', 'prop-999')).rejects.toThrow(NotFoundException);
  });
});
