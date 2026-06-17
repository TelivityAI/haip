import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ConnectController } from './connect.controller';

/**
 * Closes the last residual cross-tenant hole flagged by the Codex re-audit:
 *   `POST /connect/search` has an OPTIONAL `propertyId` in AgentSearchDto.
 *   A property-scoped credential could omit it and the search service would
 *   enumerate availability across every active tenant.
 * The controller now pins the DTO's propertyId to the credential's propertyId
 * for property-scoped callers, regardless of what (if anything) was sent.
 *
 * Also asserts the /properties/:id membership check (moved here from the guard).
 */

const A = 'aaaaaaaa-0000-4000-a000-000000000001';
const B = 'bbbbbbbb-0000-4000-b000-000000000002';

function mkController() {
  const search = { search: vi.fn().mockResolvedValue([]) };
  const content = {
    listProperties: vi.fn().mockResolvedValue([]),
    getPropertyDetail: vi.fn().mockResolvedValue({ id: A }),
  };
  const booking = { book: vi.fn(), verify: vi.fn(), modify: vi.fn(), cancel: vi.fn() };
  const events = {
    createSubscription: vi.fn(),
    listSubscriptions: vi.fn(),
    deleteSubscription: vi.fn(),
    testSubscription: vi.fn(),
    listDeliveries: vi.fn(),
    pollEvents: vi.fn(),
  };
  const insights = {
    getRevenueInsights: vi.fn(),
    getGuestTriggers: vi.fn(),
    getHousekeepingInsights: vi.fn(),
  };
  const c = new ConnectController(
    search as any,
    content as any,
    booking as any,
    events as any,
    insights as any,
  );
  return { c, search, content, booking, events, insights };
}

describe('ConnectController — search pinning', () => {
  let h: ReturnType<typeof mkController>;
  beforeEach(() => { h = mkController(); });

  it('pins dto.propertyId to the credential when scope=property AND dto omits it', async () => {
    const dto: any = { checkIn: '2026-07-01', checkOut: '2026-07-03' };
    const req: any = { connect: { scope: 'property', propertyId: A } };
    await h.c.search(dto, req);
    expect(h.search.search).toHaveBeenCalledWith(expect.objectContaining({ propertyId: A }));
  });

  it('pins dto.propertyId to the credential even if the caller sent its OWN propertyId', async () => {
    // The guard would already have allowed dto.propertyId === credential.propertyId,
    // but we belt-and-brace it here so the service can't be tricked.
    const dto: any = { propertyId: A, checkIn: '2026-07-01', checkOut: '2026-07-03' };
    const req: any = { connect: { scope: 'property', propertyId: A } };
    await h.c.search(dto, req);
    expect(h.search.search).toHaveBeenCalledWith(expect.objectContaining({ propertyId: A }));
  });

  it('does NOT pin for scope=platform (the demo gateway / trusted server-side caller)', async () => {
    const dto: any = { checkIn: '2026-07-01', checkOut: '2026-07-03' };
    const req: any = { connect: { scope: 'platform' } };
    await h.c.search(dto, req);
    expect(h.search.search).toHaveBeenCalledWith(expect.not.objectContaining({ propertyId: expect.any(String) }));
  });
});

describe('ConnectController — /connect/properties/:id', () => {
  let h: ReturnType<typeof mkController>;
  beforeEach(() => { h = mkController(); });

  it('DENIES a property-A credential reading /connect/properties/B', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A } };
    await expect(h.c.getProperty(B, req)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a property-A credential reading /connect/properties/A', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A } };
    await expect(h.c.getProperty(A, req)).resolves.toEqual({ id: A });
  });

  it('allows scope=platform to read any property', async () => {
    const req: any = { connect: { scope: 'platform' } };
    await expect(h.c.getProperty(B, req)).resolves.toEqual({ id: A });
  });
});

describe('ConnectController — /connect/properties list', () => {
  let h: ReturnType<typeof mkController>;
  beforeEach(() => { h = mkController(); });

  it('property-scoped caller only sees their own tenant (no enumeration)', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A } };
    const out = await h.c.listProperties({} as any, req);
    expect(h.content.getPropertyDetail).toHaveBeenCalledWith(A);
    expect(h.content.listProperties).not.toHaveBeenCalled();
    expect(out).toEqual([{ id: A }]);
  });

  it('platform-scoped caller can list all properties', async () => {
    const req: any = { connect: { scope: 'platform' } };
    await h.c.listProperties({ limit: 50 } as any, req);
    expect(h.content.listProperties).toHaveBeenCalled();
    expect(h.content.getPropertyDetail).not.toHaveBeenCalled();
  });
});
