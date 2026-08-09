import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuestCommunicationAgent } from './guest-communication.agent';

function chainSelect(rows: any[]) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    then: (resolve: (v: any) => void) => resolve(rows),
  };
  return chain;
}

describe('GuestCommunicationAgent', () => {
  const runSelect = vi.fn();
  const db = { select: runSelect };
  const getOrCreateConfig = vi.fn();
  const emailService = { isConfigured: vi.fn(), send: vi.fn() };
  let agent: GuestCommunicationAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateConfig.mockResolvedValue({
      config: {
        enabledTypes: ['confirmation', 'pre_arrival', 'day_of', 'post_stay', 'win_back'],
        preArrivalDaysBefore: 3,
        postStayDelayHours: 24,
        winBackDays: 90,
      },
    });
    agent = new GuestCommunicationAgent(
      db as any,
      { getOrCreateConfig } as any,
      emailService as any,
    );
  });

  it('recommend generates pre_arrival on scheduled run', async () => {
    const arrival = new Date();
    arrival.setUTCDate(arrival.getUTCDate() + 2);
    const arrivalDate = arrival.toISOString().split('T')[0]!;

    runSelect
      .mockReturnValueOnce(chainSelect([{ id: 'prop-1', name: 'Hotel', checkInTime: '15:00', checkOutTime: '11:00' }]))
      .mockReturnValueOnce(chainSelect([{ id: 'res-1', guestId: 'g-1', bookingId: 'b-1', roomTypeId: 'rt-1', ratePlanId: 'rp-1', arrivalDate, departureDate: '2026-12-01', nights: 1, status: 'confirmed' }]))
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ id: 'g-1', firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com', gdprConsentMarketing: true }]))
      .mockReturnValueOnce(chainSelect([{ id: 'b-1', confirmationNumber: 'CONF-1' }]))
      .mockReturnValueOnce(chainSelect([{ id: 'rt-1', name: 'King' }]))
      .mockReturnValueOnce(chainSelect([{ id: 'rp-1', name: 'BAR' }]))
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([]));

    const analysis = await agent.analyze('prop-1');
    const decisions = await agent.recommend(analysis);
    expect(decisions.some((d) => (d.recommendation as any).emailType === 'pre_arrival')).toBe(true);
  });

  it('recommend skips post_stay on checkout event until delay elapsed', async () => {
    const checkedOutAt = new Date();
    runSelect
      .mockReturnValueOnce(chainSelect([{ id: 'prop-1', name: 'Hotel', checkInTime: '15:00', checkOutTime: '11:00' }]))
      .mockReturnValueOnce(chainSelect([{
        id: 'res-1',
        guestId: 'g-1',
        bookingId: 'b-1',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        arrivalDate: '2026-04-10',
        departureDate: '2026-04-12',
        nights: 2,
        status: 'checked_out',
        checkedOutAt,
      }]))
      .mockReturnValueOnce(chainSelect([{ id: 'g-1', firstName: 'Bob', lastName: 'Ray', email: 'bob@example.com', gdprConsentMarketing: true }]))
      .mockReturnValueOnce(chainSelect([{ id: 'b-1', confirmationNumber: 'CONF-2' }]))
      .mockReturnValueOnce(chainSelect([{ id: 'rt-1', name: 'Queen' }]))
      .mockReturnValueOnce(chainSelect([{ id: 'rp-1', name: 'BAR' }]))
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ guestId: 'g-1', status: 'checked_out' }]));

    const analysis = await agent.analyze('prop-1', {
      eventPayload: { event: 'reservation.checked_out', reservationId: 'res-1' },
    });
    const decisions = await agent.recommend(analysis);
    expect(decisions).toHaveLength(0);
  });

  it('execute sends email when provider is configured', async () => {
    emailService.isConfigured.mockReturnValue(true);
    emailService.send.mockResolvedValue({ sent: true, provider: 'sendgrid' });

    const result = await agent.execute({
      recommendation: {
        to: 'guest@example.com',
        subject: 'Hi',
        bodyHtml: '<p>Hi</p>',
        bodyText: 'Hi',
        emailType: 'confirmation',
      },
    } as any);

    expect(emailService.send).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.changes[0].action).toBe('sent');
  });

  it('execute drafts when no email provider configured', async () => {
    emailService.isConfigured.mockReturnValue(false);
    const result = await agent.execute({
      recommendation: { to: 'guest@example.com', emailType: 'confirmation' },
    } as any);
    expect(emailService.send).not.toHaveBeenCalled();
    expect(result.changes[0].action).toBe('drafted');
  });
});
