import { Injectable, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq, and } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { ariSyncLogs, ratePlans, rateRestrictions } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { ChannelAdapterFactory } from './channel-adapter.factory';
import { ChannelService } from './channel.service';
import { AvailabilityService } from '../reservation/availability.service';
import { WebhookService } from '../webhook/webhook.service';
import type { WebhookPayload } from '../webhook/webhook.service';
import type {
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
  ChannelSyncResult,
} from './channel-adapter.interface';

@Injectable()
export class AriService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly channelService: ChannelService,
    private readonly availabilityService: AvailabilityService,
    private readonly webhookService: WebhookService,
  ) {}

  /**
   * Push availability to one or all active channels (KB 6.1).
   */
  async pushAvailability(
    propertyId: string,
    startDate: string,
    endDate: string,
    channelConnectionId?: string,
    ariUpdateType?: 'Delta' | 'Overlay',
  ) {
    const connections = channelConnectionId
      ? [await this.channelService.findById(channelConnectionId, propertyId)]
      : await this.channelService.getActiveConnections(propertyId);

    const results: Array<{ channelConnectionId: string; result: ChannelSyncResult }> = [];

    for (const conn of connections) {
      const roomTypeMapping = (conn.roomTypeMapping ?? []) as Array<{ roomTypeId: string; channelRoomCode: string }>;
      if (roomTypeMapping.length === 0) continue;

      // Calculate next day after endDate for availability query (exclusive end)
      const endDateExclusive = this.addDays(endDate, 1);

      const items: AvailabilityPushParams['items'] = [];

      for (const mapping of roomTypeMapping) {
        const availability = await this.availabilityService.searchAvailability(
          propertyId,
          startDate,
          endDateExclusive,
          mapping.roomTypeId,
        );

        // Apply inventory controls from channel config
        const config = (conn.config ?? {}) as Record<string, unknown>;
        const inventoryMode = (config['inventoryMode'] as string) ?? 'full';
        const inventoryPct = (config['inventoryPercentage'] as number) ?? 100;
        const allowOverbooking = (config['allowOverbooking'] as boolean) ?? true;

        for (const avail of availability) {
          let available = avail.available;

          if (!allowOverbooking) {
            available = Math.max(0, available - avail.overbookingBuffer);
          }

          if (inventoryMode === 'restricted') {
            available = Math.floor(available * (inventoryPct / 100));
          }

          items.push({
            channelRoomCode: mapping.channelRoomCode,
            date: avail.date,
            available,
            totalInventory: avail.totalRooms,
          });
        }
      }

      if (items.length === 0) continue;

      const adapter = this.adapterFactory.getAdapter(conn.adapterType);
      const connectionConfig: Record<string, unknown> = {
        ...((conn.config ?? {}) as Record<string, unknown>),
        ...(ariUpdateType ? { ariUpdateType } : {}),
      };
      const result = await adapter.pushAvailability({
        propertyId,
        channelConnectionId: conn.id,
        connectionConfig,
        items,
      });

      // Log sync
      await this.logSync(propertyId, conn.id, 'push', 'availability_push', items, result, startDate, endDate);
      await this.channelService.updateSyncStatus(
        conn.id,
        conn.propertyId,
        result.success ? 'success' : 'failed',
        result.errors.length > 0 ? result.errors[0]!.message : undefined,
      );

      results.push({ channelConnectionId: conn.id, result });
    }

    return results;
  }

  /**
   * Push rates and restrictions to one or all active channels (KB 6.1).
   */
  async pushRates(
    propertyId: string,
    startDate: string,
    endDate: string,
    channelConnectionId?: string,
    ariUpdateType?: 'Delta' | 'Overlay',
  ) {
    const connections = channelConnectionId
      ? [await this.channelService.findById(channelConnectionId, propertyId)]
      : await this.channelService.getActiveConnections(propertyId);

    const results: Array<{ channelConnectionId: string; rateResult: ChannelSyncResult; restrictionResult: ChannelSyncResult }> = [];

    for (const conn of connections) {
      const ratePlanMapping = (conn.ratePlanMapping ?? []) as Array<{ ratePlanId: string; channelRateCode: string }>;
      const roomTypeMapping = (conn.roomTypeMapping ?? []) as Array<{ roomTypeId: string; channelRoomCode: string }>;
      if (ratePlanMapping.length === 0 || roomTypeMapping.length === 0) continue;

      const rateItems: RatePushParams['items'] = [];
      const restrictionItems: RestrictionPushParams['items'] = [];

      for (const rateMapping of ratePlanMapping) {
        // Get rate plan details — scoped to the connection's property
        const [ratePlan] = await this.db
          .select()
          .from(ratePlans)
          .where(
            and(
              eq(ratePlans.id, rateMapping.ratePlanId),
              eq(ratePlans.propertyId, propertyId),
            ),
          );

        if (!ratePlan) continue;

        // Find matching room type mapping
        const roomMapping = roomTypeMapping.find(
          (m) => m.roomTypeId === ratePlan.roomTypeId,
        );
        if (!roomMapping) continue;

        // Get restrictions for this rate plan in the date range
        const restrictions = await this.db
          .select()
          .from(rateRestrictions)
          .where(
            and(
              eq(rateRestrictions.ratePlanId, rateMapping.ratePlanId),
              eq(rateRestrictions.propertyId, propertyId),
            ),
          );

        // Generate per-date items
        const start = new Date(startDate);
        const end = new Date(endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0]!;
          const baseRate = new Decimal(ratePlan.baseAmount).toNumber();

          rateItems.push({
            channelRoomCode: roomMapping.channelRoomCode,
            channelRateCode: rateMapping.channelRateCode,
            date: dateStr,
            amount: baseRate,
            currencyCode: ratePlan.currencyCode,
          });

          // Find applicable restriction for this date
          const restriction = restrictions.find(
            (r: any) => r.startDate <= dateStr && r.endDate >= dateStr,
          );

          restrictionItems.push({
            channelRoomCode: roomMapping.channelRoomCode,
            channelRateCode: rateMapping.channelRateCode,
            date: dateStr,
            stopSell: restriction?.isClosed ?? false,
            closedToArrival: restriction?.closedToArrival ?? false,
            closedToDeparture: restriction?.closedToDeparture ?? false,
            minLos: restriction?.minLos ?? undefined,
            maxLos: restriction?.maxLos ?? undefined,
          });
        }
      }

      const adapter = this.adapterFactory.getAdapter(conn.adapterType);

      const connectionConfig: Record<string, unknown> = {
        ...((conn.config ?? {}) as Record<string, unknown>),
        ...(ariUpdateType ? { ariUpdateType } : {}),
      };
      const rateResult = rateItems.length > 0
        ? await adapter.pushRates({ propertyId, channelConnectionId: conn.id, connectionConfig, items: rateItems })
        : { success: true, itemsSynced: 0, errors: [] };

      const restrictionResult = restrictionItems.length > 0
        ? await adapter.pushRestrictions({ propertyId, channelConnectionId: conn.id, connectionConfig, items: restrictionItems })
        : { success: true, itemsSynced: 0, errors: [] };

      // Log syncs
      await this.logSync(propertyId, conn.id, 'push', 'rate_push', rateItems, rateResult, startDate, endDate);
      await this.logSync(propertyId, conn.id, 'push', 'restriction_push', restrictionItems, restrictionResult, startDate, endDate);

      const overallSuccess = rateResult.success && restrictionResult.success;
      await this.channelService.updateSyncStatus(
        conn.id,
        conn.propertyId,
        overallSuccess ? 'success' : 'failed',
        [...rateResult.errors, ...restrictionResult.errors].map((e) => e.message).join('; ') || undefined,
      );

      results.push({ channelConnectionId: conn.id, rateResult, restrictionResult });
    }

    return results;
  }

  /**
   * Push full ARI (availability + rates + restrictions) — convenience method.
   * Pass ariUpdateType='Overlay' for DerbySoft full refresh (issue #93 flush).
   */
  async pushFullARI(
    propertyId: string,
    startDate: string,
    endDate: string,
    channelConnectionId?: string,
    ariUpdateType?: 'Delta' | 'Overlay',
  ) {
    const availabilityResults = await this.pushAvailability(
      propertyId,
      startDate,
      endDate,
      channelConnectionId,
      ariUpdateType,
    );
    const rateResults = await this.pushRates(
      propertyId,
      startDate,
      endDate,
      channelConnectionId,
      ariUpdateType,
    );

    return { availability: availabilityResults, rates: rateResults };
  }

  /**
   * Schedule a full Overlay ARI flush asynchronously.
   * Channel BullMQ workers are not wired yet (same pragmatic stance as webhook
   * delivery) — runs fire-and-forget on the event loop.
   */
  scheduleFullFlush(
    propertyId: string,
    startDate: string,
    endDate: string,
    channelConnectionId?: string,
  ): { queued: true } {
    setImmediate(() => {
      void this.pushFullARI(propertyId, startDate, endDate, channelConnectionId, 'Overlay').catch(
        () => undefined,
      );
    });
    return { queued: true };
  }

  /**
   * Get sync logs for a channel connection.
   */
  async getSyncLogs(channelConnectionId: string, propertyId: string, limit = 50) {
    return this.db
      .select()
      .from(ariSyncLogs)
      .where(
        and(
          eq(ariSyncLogs.channelConnectionId, channelConnectionId),
          eq(ariSyncLogs.propertyId, propertyId),
        ),
      )
      .orderBy(ariSyncLogs.createdAt)
      .limit(limit);
  }

  /**
   * Push stop-sell (zero availability) for a channel on a date range.
   */
  async pushStopSell(
    channelConnectionId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
    roomTypeId?: string,
  ) {
    const conn = await this.channelService.findById(channelConnectionId, propertyId);
    const roomTypeMapping = (conn.roomTypeMapping ?? []) as Array<{ roomTypeId: string; channelRoomCode: string }>;
    const mappings = roomTypeId
      ? roomTypeMapping.filter((m) => m.roomTypeId === roomTypeId)
      : roomTypeMapping;

    const items: AvailabilityPushParams['items'] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (const mapping of mappings) {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        items.push({
          channelRoomCode: mapping.channelRoomCode,
          date: d.toISOString().split('T')[0]!,
          available: 0,
          totalInventory: 0,
        });
      }
    }

    const adapter = this.adapterFactory.getAdapter(conn.adapterType);
    const result = await adapter.pushAvailability({
      propertyId,
      channelConnectionId,
      connectionConfig: (conn.config ?? {}) as Record<string, unknown>,
      items,
    });

    await this.logSync(propertyId, channelConnectionId, 'push', 'stop_sell', items, result, startDate, endDate);

    return result;
  }

  // --- Event-Driven ARI Push ---

  @OnEvent('reservation.created')
  async handleReservationCreated(payload: WebhookPayload) {
    if (!payload.propertyId) return;
    try {
      // Push updated availability for the reservation date range
      const data = payload.data as Record<string, unknown>;
      const arrivalDate = data['arrivalDate'] as string | undefined;
      const departureDate = data['departureDate'] as string | undefined;
      if (arrivalDate && departureDate) {
        await this.pushAvailability(payload.propertyId, arrivalDate, departureDate);
      }
    } catch {
      // Fire-and-forget: don't crash on push failure
    }
  }

  @OnEvent('reservation.modified')
  async handleReservationModified(payload: WebhookPayload) {
    if (!payload.propertyId) return;
    try {
      const data = payload.data as Record<string, unknown>;
      // Push availability for both old and new windows so channels see the freed + taken inventory.
      const arrivalDate = data['arrivalDate'] as string | undefined;
      const departureDate = data['departureDate'] as string | undefined;
      const prevArrival = data['previousArrivalDate'] as string | undefined;
      const prevDeparture = data['previousDepartureDate'] as string | undefined;
      if (arrivalDate && departureDate) {
        await this.pushAvailability(payload.propertyId, arrivalDate, departureDate);
      }
      if (prevArrival && prevDeparture && (prevArrival !== arrivalDate || prevDeparture !== departureDate)) {
        await this.pushAvailability(payload.propertyId, prevArrival, prevDeparture);
      }
    } catch {
      // Fire-and-forget
    }
  }

  @OnEvent('reservation.cancelled')
  async handleReservationCancelled(payload: WebhookPayload) {
    if (!payload.propertyId) return;
    try {
      const data = payload.data as Record<string, unknown>;
      const arrivalDate = data['arrivalDate'] as string | undefined;
      const departureDate = data['departureDate'] as string | undefined;
      if (arrivalDate && departureDate) {
        await this.pushAvailability(payload.propertyId, arrivalDate, departureDate);
      }
    } catch {
      // Fire-and-forget
    }
  }

  // --- Private Helpers ---

  private async logSync(
    propertyId: string,
    channelConnectionId: string,
    direction: string,
    action: string,
    payload: unknown,
    result: ChannelSyncResult,
    startDate: string,
    endDate: string,
  ) {
    await this.db
      .insert(ariSyncLogs)
      .values({
        propertyId,
        channelConnectionId,
        direction: direction as any,
        action,
        payload,
        response: result,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.errors.length > 0
          ? result.errors.map((e) => e.message).join('; ')
          : null,
        dateRangeStart: startDate,
        dateRangeEnd: endDate,
      });
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]!;
  }
}
