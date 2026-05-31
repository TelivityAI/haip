import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReservationMessagingService } from './reservation-messaging.service';
import { WebhookService } from '../webhook/webhook.service';
import { EmailService } from '../agent/guest-comms/email.service';
import { DRIZZLE } from '../../database/database.module';

const mockReservation = { id: 'res-001', propertyId: 'prop-001', guestId: 'guest-001' };

const mockWebhookService = { emit: vi.fn() };
const mockEmailService = { send: vi.fn().mockResolvedValue({ sent: false, error: 'SMTP not configured' }) };

function createMockDb(selectReturns: any[][]) {
  const selects = [...selectReturns];
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const next = selects.shift() ?? [];
          return { then: (resolve: any) => resolve(next) };
        }),
      }),
    })),
  };
}

async function createService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReservationMessagingService,
      { provide: DRIZZLE, useValue: db },
      { provide: EmailService, useValue: mockEmailService },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<ReservationMessagingService>(ReservationMessagingService);
}

describe('ReservationMessagingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailService.send.mockResolvedValue({ sent: false, error: 'SMTP not configured' });
  });

  it('sends and emits reservation.message_sent', async () => {
    const guest = { id: 'guest-001', email: 'guest@example.com', gdprConsentMarketing: false };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);

    const result = await svc.composeMessage('prop-001', 'res-001', { propertyId: 'prop-001', subject: 'Hi', body: 'Welcome' });

    expect(mockEmailService.send).toHaveBeenCalledWith({
      to: 'guest@example.com',
      subject: 'Hi',
      html: 'Welcome',
      text: 'Welcome',
    });
    expect(result.sent).toBe(false); // draft when SMTP unconfigured
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.message_sent',
      'reservation',
      'res-001',
      expect.objectContaining({ to: 'guest@example.com' }),
      'prop-001',
    );
  });

  it('rejects when reservation not in property', async () => {
    const db = createMockDb([[]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', { propertyId: 'prop-001', subject: 's', body: 'b' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when guest has no email', async () => {
    const guest = { id: 'guest-001', email: null, gdprConsentMarketing: true };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', { propertyId: 'prop-001', subject: 's', body: 'b' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks marketing message when guest opted out (GDPR)', async () => {
    const guest = { id: 'guest-001', email: 'guest@example.com', gdprConsentMarketing: false };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', { propertyId: 'prop-001', subject: 's', body: 'b', isMarketing: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockEmailService.send).not.toHaveBeenCalled();
  });

  it('allows marketing message when guest opted in', async () => {
    const guest = { id: 'guest-001', email: 'guest@example.com', gdprConsentMarketing: true };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await svc.composeMessage('prop-001', 'res-001', { propertyId: 'prop-001', subject: 's', body: 'b', isMarketing: true });
    expect(mockEmailService.send).toHaveBeenCalled();
  });
});
