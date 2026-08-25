import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WEBHOOK_EVENTS } from '@telivityhaip/shared';
import { getSocket } from '../lib/socket';

interface PmsEventPayload {
  event: string;
  entityId?: string;
  propertyId?: string;
  data?: Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function uniqueKeys(keys: string[][]): string[][] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const identity = JSON.stringify(key);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

/**
 * Map only the shared, typed event catalog. Every returned key carries the
 * event's property scope so activity at one hotel cannot disturb another
 * hotel's in-progress review workspace.
 */
export function realtimeQueryKeys(payload: PmsEventPayload): string[][] {
  const propertyId = payload.propertyId ?? stringValue(payload.data?.propertyId);
  if (
    !propertyId
    || !Object.prototype.hasOwnProperty.call(WEBHOOK_EVENTS, payload.event)
  ) return [];

  const data = payload.data ?? {};
  const requestId = stringValue(data.bookingRequestId)
    ?? stringValue(data.requestId)
    ?? (payload.event.startsWith('booking_request.') ? payload.entityId : undefined);
  const reservationId = stringValue(data.reservationId)
    ?? (payload.event.startsWith('reservation.') ? payload.entityId : undefined);
  const folioId = stringValue(data.folioId)
    ?? (payload.event.startsWith('folio.') ? payload.entityId : undefined);

  const requestKeys = (includeRoot = true): string[][] => [
    ...(includeRoot ? [['booking-requests', propertyId]] : []),
    ...(requestId ? [
      ['booking-request-payments', propertyId, requestId],
      ['booking-request-installments', propertyId, requestId],
      ['booking-request-messages', propertyId, requestId],
      ['booking-request-audit', propertyId, requestId],
    ] : []),
  ];

  if (payload.event.startsWith('booking_request.')) {
    return uniqueKeys([
      ...requestKeys(),
      ...(reservationId ? [['reservations', propertyId]] : []),
      ...(folioId ? [['folios', propertyId]] : []),
      ...(folioId ? [['payments', propertyId]] : []),
    ]);
  }
  if (payload.event.startsWith('payment.')) {
    return uniqueKeys([
      ['payments', propertyId],
      ['folios', propertyId],
      ...requestKeys(Boolean(requestId)),
    ]);
  }
  if (payload.event.startsWith('reservation.')) {
    return uniqueKeys([
      ['reservations', propertyId],
      ['rooms', propertyId],
      ['reports', propertyId],
      ...(requestId || reservationId ? requestKeys(Boolean(requestId)) : []),
    ]);
  }
  if (payload.event.startsWith('folio.')) {
    return uniqueKeys([
      ['folios', propertyId],
      ['payments', propertyId],
      ...(requestId || folioId ? requestKeys(Boolean(requestId)) : []),
    ]);
  }
  if (payload.event.startsWith('audit.')) {
    return uniqueKeys([
      ['audit', propertyId],
      ['reports', propertyId],
      ...requestKeys(Boolean(requestId)),
    ]);
  }
  if (payload.event.startsWith('room.')) return [['rooms', propertyId], ['housekeeping', propertyId]];
  if (payload.event.startsWith('housekeeping.')) return [['housekeeping', propertyId], ['rooms', propertyId]];
  if (payload.event.startsWith('channel.')) return [['channels', propertyId]];
  if (payload.event.startsWith('agent.')) {
    return [['agents', propertyId], ['agent-decisions', propertyId], ['agent-performance', propertyId]];
  }
  if (payload.event.startsWith('guest.')) return [['agent-decisions', propertyId], ['reviews', propertyId]];
  if (payload.event.startsWith('connect.')) return [['connect', propertyId]];
  return [];
}

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    function handleEvent(payload: PmsEventPayload) {
      if (!payload?.event) return;
      for (const key of realtimeQueryKeys(payload)) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }

    socket.on('pmsEvent', handleEvent);
    return () => {
      socket.off('pmsEvent', handleEvent);
    };
  }, [queryClient]);
}
