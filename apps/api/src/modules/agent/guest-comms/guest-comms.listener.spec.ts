import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { GuestCommsListener } from './guest-comms.listener';
import { AgentService } from '../agent.service';

describe('GuestCommsListener', () => {
  let listener: GuestCommsListener;
  const runAgent = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestCommsListener,
        { provide: AgentService, useValue: { runAgent } },
      ],
    }).compile();
    listener = module.get(GuestCommsListener);
  });

  it('runs guest_comms on reservation.created with reservationId', async () => {
    await listener.onCreated({
      event: 'reservation.created',
      entityType: 'reservation',
      entityId: 'res-1',
      propertyId: 'prop-1',
      data: {},
      timestamp: new Date().toISOString(),
    } as any);
    expect(runAgent).toHaveBeenCalledWith('prop-1', 'guest_comms', {
      triggeredBy: 'event',
      eventPayload: { event: 'reservation.created', reservationId: 'res-1' },
    });
  });

  it('runs guest_comms on checked_in and checked_out', async () => {
    await listener.onCheckedIn({
      entityId: 'res-2',
      propertyId: 'prop-1',
      data: {},
    } as any);
    await listener.onCheckedOut({
      entityId: 'res-3',
      propertyId: 'prop-1',
      data: {},
    } as any);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(runAgent.mock.calls[0][2].eventPayload.event).toBe('reservation.checked_in');
    expect(runAgent.mock.calls[1][2].eventPayload.event).toBe('reservation.checked_out');
  });

  it('swallows runAgent failures', async () => {
    runAgent.mockRejectedValueOnce(new Error('agent down'));
    await expect(
      listener.onCreated({
        entityId: 'res-1',
        propertyId: 'prop-1',
        data: {},
      } as any),
    ).resolves.toBeUndefined();
  });

  it('no-ops when propertyId or entityId missing', async () => {
    await listener.onCreated({ entityId: 'res-1', data: {} } as any);
    await listener.onCreated({ propertyId: 'prop-1', data: {} } as any);
    expect(runAgent).not.toHaveBeenCalled();
  });
});
