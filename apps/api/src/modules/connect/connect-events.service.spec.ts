import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ConnectEventsService } from './connect-events.service';

describe('ConnectEventsService', () => {
  let service: ConnectEventsService;
  let mockDb: any;

  const mockSubscription = {
    id: 'sub-1',
    propertyId: 'prop-1',
    subscriberId: 'otaip-agent-v1',
    subscriberName: 'OTAIP Booking Agent',
    callbackUrl: 'https://otaip.example.com/webhooks',
    events: ['reservation.*', 'folio.charge_posted'],
    secret: 'whsec_supersecret',
    isActive: true,
    failureCount: 0,
  };

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockSubscription]),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };

    service = new ConnectEventsService(mockDb);
  });

  describe('createSubscription', () => {
    it('should create a subscription', async () => {
      const result = await service.createSubscription({
        propertyId: 'prop-1',
        subscriberId: 'otaip-agent-v1',
        callbackUrl: 'https://otaip.example.com/webhooks',
        events: ['reservation.*'],
      });

      expect(result.id).toBe('sub-1');
      expect(result.subscriberId).toBe('otaip-agent-v1');
    });

    it('never returns the HMAC secret in the response', async () => {
      const result = await service.createSubscription({
        propertyId: 'prop-1',
        subscriberId: 'otaip-agent-v1',
        callbackUrl: 'https://otaip.example.com/webhooks',
        events: ['reservation.*'],
        secret: 'whsec_supersecret',
      } as any);

      expect((result as any).secret).toBeUndefined();
    });
  });

  describe('listSubscriptions', () => {
    it('should list active subscriptions for a property', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockSubscription]),
        }),
      }));

      const result = await service.listSubscriptions('prop-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.subscriberId).toBe('otaip-agent-v1');
    });

    it('never returns the HMAC secret in listed subscriptions', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockSubscription]),
        }),
      }));

      const result = await service.listSubscriptions('prop-1');

      expect((result[0] as any).secret).toBeUndefined();
    });
  });

  describe('deleteSubscription', () => {
    it('should deactivate a subscription', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockSubscription]),
        }),
      }));

      const result = await service.deleteSubscription('sub-1', 'prop-1');

      expect(result.deleted).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent subscription', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }));

      await expect(service.deleteSubscription('nonexistent', 'prop-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('testSubscription', () => {
    it('should log a test event delivery', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockSubscription]),
        }),
      }));

      const result = await service.testSubscription('sub-1', 'prop-1');

      expect(result.testSent).toBe(true);
      expect(result.callbackUrl).toBe('https://otaip.example.com/webhooks');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('matchesEventPattern', () => {
    it('should match exact event types', () => {
      expect(service.matchesEventPattern('reservation.created', 'reservation.created')).toBe(true);
      expect(service.matchesEventPattern('reservation.created', 'reservation.cancelled')).toBe(false);
    });

    it('should match wildcard patterns', () => {
      expect(service.matchesEventPattern('reservation.created', 'reservation.*')).toBe(true);
      expect(service.matchesEventPattern('reservation.cancelled', 'reservation.*')).toBe(true);
      expect(service.matchesEventPattern('folio.charge_posted', 'reservation.*')).toBe(false);
    });

    it('should match global wildcard', () => {
      expect(service.matchesEventPattern('reservation.created', '*')).toBe(true);
      expect(service.matchesEventPattern('folio.settled', '**')).toBe(true);
    });
  });

  describe('handleEvent', () => {
    it('enqueues a delivery via WebhookDeliveryService for each matching subscription', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockSubscription]),
        }),
      }));

      const deliveryService = { enqueue: vi.fn().mockResolvedValue({ id: 'del-1' }) };
      const svc = new ConnectEventsService(mockDb, deliveryService as any);

      await svc.handleEvent({
        event: 'reservation.created',
        entityType: 'reservation',
        entityId: 'res-1',
        propertyId: 'prop-1',
        data: { foo: 'bar' },
        timestamp: new Date().toISOString(),
      });

      expect(deliveryService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'reservation.created',
          propertyId: 'prop-1',
          entityType: 'reservation',
          entityId: 'res-1',
        }),
        'sub-1',
      );
    });

    it('does nothing when no subscriptions match', async () => {
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockSubscription]),
        }),
      }));
      const deliveryService = { enqueue: vi.fn() };
      const svc = new ConnectEventsService(mockDb, deliveryService as any);

      await svc.handleEvent({
        event: 'unrelated.event',
        entityType: 'x',
        entityId: 'y',
        propertyId: 'prop-1',
        data: {},
        timestamp: new Date().toISOString(),
      });

      expect(deliveryService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('pollEvents', () => {
    it('should return events filtered by type', async () => {
      const mockEvents = [
        { id: 'e1', entityType: 'reservation', action: 'created', propertyId: 'prop-1', newValue: {}, occurredAt: new Date() },
        { id: 'e2', entityType: 'folio', action: 'charge_posted', propertyId: 'prop-1', newValue: {}, occurredAt: new Date() },
      ];

      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockEvents),
            }),
          }),
        }),
      }));

      const result = await service.pollEvents('prop-1', undefined, ['reservation.*']);

      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('reservation.created');
    });

    it('should return all events when no type filter', async () => {
      const mockEvents = [
        { id: 'e1', entityType: 'reservation', action: 'created', propertyId: 'prop-1', newValue: {}, occurredAt: new Date() },
      ];

      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockEvents),
            }),
          }),
        }),
      }));

      const result = await service.pollEvents('prop-1');

      expect(result).toHaveLength(1);
    });
  });
});
