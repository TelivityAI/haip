import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ChannelService } from './channel.service';

function createMockDb() {
  const returning = vi.fn();
  const whereThen = vi.fn();
  const chain = {
    values: vi.fn().mockReturnValue({ returning }),
    set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) }),
    where: whereThen,
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(chain) }),
      insert: vi.fn().mockReturnValue(chain),
      update: vi.fn().mockReturnValue(chain),
    },
    returning,
    where: whereThen,
    chain,
  };
}

describe('ChannelService', () => {
  let service: ChannelService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockWebhookService: any;
  let mockAdapterFactory: any;

  beforeEach(() => {
    mockDb = createMockDb();
    mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };
    mockAdapterFactory = {
      getAdapter: vi.fn().mockReturnValue({
        testConnection: vi.fn().mockResolvedValue({ connected: true, message: 'OK' }),
      }),
    };
    service = new ChannelService(mockDb.db as any, mockWebhookService, mockAdapterFactory);
  });

  describe('create', () => {
    it('should create a channel connection and emit webhook', async () => {
      const dto = {
        propertyId: 'prop-1',
        channelCode: 'booking_com',
        channelName: 'Booking.com',
        adapterType: 'mock',
      };
      const connection = { id: 'conn-1', ...dto };
      mockDb.returning.mockResolvedValue([connection]);

      const result = await service.create(dto as any);

      expect(result).toEqual(connection);
      expect(mockAdapterFactory.getAdapter).toHaveBeenCalledWith('mock');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'channel.connected',
        'channel_connection',
        'conn-1',
        expect.objectContaining({ channelCode: 'booking_com' }),
        'prop-1',
      );
    });
  });

  describe('findById', () => {
    it('should return connection when found', async () => {
      const connection = { id: 'conn-1', propertyId: 'prop-1' };
      mockDb.where.mockResolvedValue([connection]);

      const result = await service.findById('conn-1', 'prop-1');

      expect(result).toEqual(connection);
    });

    it('should throw NotFoundException when not found', async () => {
      mockDb.where.mockResolvedValue([]);

      await expect(service.findById('conn-1', 'prop-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should list active connections for a property', async () => {
      const connections = [{ id: 'conn-1' }, { id: 'conn-2' }];
      mockDb.where.mockResolvedValue(connections);

      const result = await service.list('prop-1');

      expect(result).toEqual(connections);
    });
  });

  describe('getActiveConnections', () => {
    it('should return only active connections', async () => {
      const connections = [{ id: 'conn-1', status: 'active' }];
      mockDb.where.mockResolvedValue(connections);

      const result = await service.getActiveConnections('prop-1');

      expect(result).toEqual(connections);
    });
  });

  describe('update', () => {
    it('should update connection fields', async () => {
      // findById
      mockDb.where.mockResolvedValueOnce([{ id: 'conn-1', propertyId: 'prop-1' }]);

      const updated = { id: 'conn-1', channelName: 'Updated' };
      const updateChain = {
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updated]) }),
      };
      mockDb.chain.set.mockReturnValue(updateChain);

      const result = await service.update('conn-1', 'prop-1', { channelName: 'Updated' });

      expect(result).toEqual(updated);
    });
  });

  describe('deactivate', () => {
    it('should deactivate connection and emit webhook', async () => {
      const connection = { id: 'conn-1', propertyId: 'prop-1', channelCode: 'booking_com' };
      // findById call
      mockDb.where.mockResolvedValueOnce([connection]);

      const deactivated = { ...connection, isActive: false, status: 'inactive' };
      const updateChain = {
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([deactivated]) }),
      };
      mockDb.chain.set.mockReturnValue(updateChain);

      const result = await service.deactivate('conn-1', 'prop-1');

      expect(result).toEqual(deactivated);
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'channel.disconnected',
        'channel_connection',
        'conn-1',
        expect.objectContaining({ channelCode: 'booking_com' }),
        'prop-1',
      );
    });
  });

  describe('testConnection', () => {
    it('should test connection via adapter', async () => {
      const connection = { id: 'conn-1', propertyId: 'prop-1', adapterType: 'mock', config: {} };
      mockDb.where.mockResolvedValueOnce([connection]);

      const result = await service.testConnection('conn-1', 'prop-1');

      expect(result).toEqual({ connected: true, message: 'OK' });
      expect(mockAdapterFactory.getAdapter).toHaveBeenCalledWith('mock');
    });
  });

  describe('updateSyncStatus', () => {
    it('should update sync status fields', async () => {
      const updateChain = { where: vi.fn().mockResolvedValue(undefined) };
      mockDb.chain.set.mockReturnValue(updateChain);

      await service.updateSyncStatus('conn-1', 'prop-1', 'success');

      expect(mockDb.db.update).toHaveBeenCalled();
    });

    it('should include error message when provided', async () => {
      const updateChain = { where: vi.fn().mockResolvedValue(undefined) };
      mockDb.chain.set.mockReturnValue(updateChain);

      await service.updateSyncStatus('conn-1', 'prop-1', 'failed', 'Timeout');

      expect(mockDb.chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastSyncError: 'Timeout' }),
      );
    });
  });
});
