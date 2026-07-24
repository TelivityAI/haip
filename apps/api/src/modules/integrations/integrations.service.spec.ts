import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  function mockSelectChain(rows: unknown[]) {
    const filtered = {
      orderBy: vi.fn().mockResolvedValue(rows),
      limit: vi.fn().mockResolvedValue(rows),
    };
    const chain = {
      where: vi.fn().mockReturnValue(filtered),
      orderBy: vi.fn().mockResolvedValue(rows),
      limit: vi.fn().mockResolvedValue(rows),
    };
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue(chain),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'conn-1', enabled: true, config: {} }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'conn-1', enabled: false, config: {} }]),
          }),
        }),
      }),
    };
    return { db, chain, filtered };
  }

  it('lists the global catalog without requiring a propertyId', async () => {
    const rows = [{ slug: 'stripe', category: 'Payments', status: 'shipped' }];
    const { db, chain } = mockSelectChain(rows);
    const service = new IntegrationsService(db as any);

    await expect(service.listCatalog()).resolves.toEqual(rows);

    expect(chain.where).not.toHaveBeenCalled();
    expect(chain.orderBy).toHaveBeenCalled();
  });

  it('applies optional category and status filters', async () => {
    const rows = [{ slug: 'stripe', category: 'Payments', status: 'shipped' }];
    const { db, chain, filtered } = mockSelectChain(rows);
    const service = new IntegrationsService(db as any);

    await expect(
      service.listCatalog({ category: 'Payments', status: 'shipped' }),
    ).resolves.toEqual(rows);

    expect(chain.where).toHaveBeenCalledOnce();
    expect(filtered.orderBy).toHaveBeenCalled();
  });

  it('returns one catalog item by slug', async () => {
    const item = { slug: 'stripe', category: 'Payments', status: 'shipped' };
    const { db, chain, filtered } = mockSelectChain([item]);
    const service = new IntegrationsService(db as any);

    await expect(service.findCatalogBySlug('stripe')).resolves.toEqual(item);

    expect(chain.where).toHaveBeenCalledOnce();
    expect(filtered.limit).toHaveBeenCalledWith(1);
  });

  it('throws when a slug is not found', async () => {
    const { db } = mockSelectChain([]);
    const service = new IntegrationsService(db as any);

    await expect(service.findCatalogBySlug('missing')).rejects.toThrow(NotFoundException);
  });

  it('merges catalog rows with property connection state', async () => {
    const catalog = [
      { slug: 'stripe', category: 'Payments', status: 'shipped', name: 'Stripe' },
      { slug: 'zapier', category: 'Automation Platforms', status: 'recipe', name: 'Zapier' },
    ];
    const propertyRows = [
      { id: 'pi-1', catalogSlug: 'stripe', enabled: true, config: { webhookUrl: 'https://x' } },
    ];

    let call = 0;
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => {
          call += 1;
          if (call === 1) {
            return {
              where: vi.fn(),
              orderBy: vi.fn().mockResolvedValue(catalog),
            };
          }
          return {
            where: vi.fn().mockResolvedValue(propertyRows),
          };
        }),
      })),
    };

    const service = new IntegrationsService(db as any);
    const result = await service.listPropertyIntegrations('prop-a');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      slug: 'stripe',
      enabled: true,
      config: { webhookUrl: 'https://x' },
      connectionId: 'pi-1',
    });
    expect(result[1]).toMatchObject({
      slug: 'zapier',
      enabled: false,
      config: {},
      connectionId: null,
    });
  });

  it('scopes property integration updates by propertyId', async () => {
    const catalogItem = { slug: 'stripe', category: 'Payments', status: 'shipped' };
    const { db } = mockSelectChain([catalogItem]);
    const updateWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'pi-1', enabled: true, config: {} }]),
    });
    db.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: updateWhere }),
    });

    const service = new IntegrationsService(db as any);
    await service.upsertPropertyIntegration(
      'prop-b',
      'stripe',
      { enabled: true },
      { userId: 'user-1', email: 'admin@test.com' },
    );

    expect(updateWhere).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });
});
