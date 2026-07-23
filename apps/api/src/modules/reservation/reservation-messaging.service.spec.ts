import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReservationMessagingService } from './reservation-messaging.service';
import { WebhookService } from '../webhook/webhook.service';
import { EmailService } from '../agent/guest-comms/email.service';
import { NotificationService } from '../notifications/notification.service';
import { DRIZZLE } from '../../database/database.module';

const mockReservation = { id: 'res-001', propertyId: 'prop-001', guestId: 'guest-001' };

const mockWebhookService = { emit: vi.fn() };
const mockEmailService = { send: vi.fn().mockResolvedValue({ sent: false, error: 'SMTP not configured' }) };
const mockNotificationService = {
  sendSms: vi.fn().mockResolvedValue({ sent: false, provider: 'console', error: 'SMS not configured' }),
};

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
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<ReservationMessagingService>(ReservationMessagingService);
}

describe('ReservationMessagingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailService.send.mockResolvedValue({ sent: false, error: 'SMTP not configured' });
    mockNotificationService.sendSms.mockResolvedValue({
      sent: false,
      provider: 'console',
      error: 'SMS not configured',
    });
  });

  it('sends email and emits reservation.message_sent', async () => {
    const guest = { id: 'guest-001', email: 'guest@example.com', gdprConsentMarketing: false };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);

    const result = await svc.composeMessage('prop-001', 'res-001', {
      propertyId: 'prop-001',
      subject: 'Hi',
      body: 'Welcome',
    });

    expect(mockEmailService.send).toHaveBeenCalledWith({
      to: 'guest@example.com',
      subject: 'Hi',
      html: 'Welcome',
      text: 'Welcome',
    });
    expect(result.sent).toBe(false);
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.message_sent',
      'reservation',
      'res-001',
      expect.objectContaining({ channel: 'email', to: 'guest@example.com' }),
      'prop-001',
    );
  });

  it('sends SMS and emits reservation.message_sent with channel sms', async () => {
    const guest = {
      id: 'guest-001',
      email: 'guest@example.com',
      phone: '+15551230000',
      gdprConsentMarketing: false,
    };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);

    const result = await svc.composeMessage('prop-001', 'res-001', {
      propertyId: 'prop-001',
      channel: 'sms',
      body: 'Your room is ready',
    });

    expect(mockNotificationService.sendSms).toHaveBeenCalledWith(
      'prop-001',
      '+15551230000',
      'Your room is ready',
    );
    expect(mockEmailService.send).not.toHaveBeenCalled();
    expect(result.sent).toBe(false);
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.message_sent',
      'reservation',
      'res-001',
      expect.objectContaining({ channel: 'sms', to: '+15551230000' }),
      'prop-001',
    );
  });

  it('rejects SMS when guest has no phone', async () => {
    const guest = { id: 'guest-001', email: 'guest@example.com', phone: null, gdprConsentMarketing: true };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', {
        propertyId: 'prop-001',
        channel: 'sms',
        body: 'Hello',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockNotificationService.sendSms).not.toHaveBeenCalled();
  });

  it('rejects when reservation not in property', async () => {
    const db = createMockDb([[]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', { propertyId: 'prop-001', subject: 's', body: 'b' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when guest has no email on email channel', async () => {
    const guest = { id: 'guest-001', email: null, gdprConsentMarketing: true };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', { propertyId: 'prop-001', subject: 's', body: 'b' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks marketing SMS when guest opted out (GDPR)', async () => {
    const guest = {
      id: 'guest-001',
      email: 'guest@example.com',
      phone: '+15551230000',
      gdprConsentMarketing: false,
    };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', {
        propertyId: 'prop-001',
        channel: 'sms',
        body: 'Promo',
        isMarketing: true,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockNotificationService.sendSms).not.toHaveBeenCalled();
  });

  it('blocks marketing email when guest opted out (GDPR)', async () => {
    const guest = { id: 'guest-001', email: 'guest@example.com', gdprConsentMarketing: false };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await expect(
      svc.composeMessage('prop-001', 'res-001', {
        propertyId: 'prop-001',
        subject: 's',
        body: 'b',
        isMarketing: true,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockEmailService.send).not.toHaveBeenCalled();
  });

  it('allows marketing message when guest opted in', async () => {
    const guest = { id: 'guest-001', email: 'guest@example.com', gdprConsentMarketing: true };
    const db = createMockDb([[mockReservation], [guest]]);
    const svc = await createService(db);
    await svc.composeMessage('prop-001', 'res-001', {
      propertyId: 'prop-001',
      subject: 's',
      body: 'b',
      isMarketing: true,
    });
    expect(mockEmailService.send).toHaveBeenCalled();
  });
});
