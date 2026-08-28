import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WEBHOOK_EVENTS } from '@telivityhaip/shared';
import { getSocket } from '../lib/socket';
import { useProperty } from '../context/PropertyContext';
import { bookingRequestKeys } from '../components/booking-requests/queryKeys';

interface PmsEventPayload {
  event: string;
  data?: Record<string, unknown>;
  timestamp: string;
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
 * Socket events are delivered to an authenticated property room. The envelope
 * intentionally does not repeat that property ID, so the active room — never
 * untrusted event data — supplies the query scope.
 */
export function realtimeQueryKeys(
  propertyId: string | null,
  payload: PmsEventPayload,
): string[][] {
  if (
    !propertyId
    || !Object.prototype.hasOwnProperty.call(WEBHOOK_EVENTS, payload.event)
  ) return [];

  const data = payload.data ?? {};
  const requestId = stringValue(data.bookingRequestId)
    ?? stringValue(data.requestId);
  const reservationId = stringValue(data.reservationId);
  const folioId = stringValue(data.folioId);

  const requestKeys = (): string[][] => [
    [...bookingRequestKeys.root(propertyId)],
    [...bookingRequestKeys.paymentsRoot(propertyId)],
    [...bookingRequestKeys.installmentsRoot(propertyId)],
    [...bookingRequestKeys.messagesRoot(propertyId)],
    [...bookingRequestKeys.auditRoot(propertyId)],
    [...bookingRequestKeys.foliosRoot(propertyId)],
    ...(requestId ? [
      [...bookingRequestKeys.detail(propertyId, requestId)],
      [...bookingRequestKeys.payments(propertyId, requestId)],
      [...bookingRequestKeys.installments(propertyId, requestId)],
      [...bookingRequestKeys.messages(propertyId, requestId)],
      [...bookingRequestKeys.audit(propertyId, requestId)],
    ] : []),
    ...(requestId && folioId ? [[
      ...bookingRequestKeys.folio(
        propertyId,
        requestId,
        reservationId ?? null,
        folioId,
      ),
    ]] : []),
  ];

  if (payload.event.startsWith('booking_request.')) {
    return uniqueKeys([
      ...requestKeys(),
      ...(reservationId ? [['reservations'], ['reservations', propertyId]] : []),
      ...(folioId ? [['folios'], ['folios', propertyId]] : []),
      ...(folioId ? [['payments'], ['payments', propertyId]] : []),
    ]);
  }
  if (payload.event.startsWith('payment.')) {
    return uniqueKeys([
      ['payments'],
      ['payments', propertyId],
      ['folios'],
      ['folios', propertyId],
      ...requestKeys(),
    ]);
  }
  if (payload.event.startsWith('reservation.')) {
    return uniqueKeys([
      ['reservations'],
      ['reservations', propertyId],
      ['rooms'],
      ['rooms', propertyId],
      ['reports'],
      ['reports', propertyId],
      ...requestKeys(),
    ]);
  }
  if (payload.event.startsWith('folio.')) {
    return uniqueKeys([
      ['folios'],
      ['folios', propertyId],
      ['payments'],
      ['payments', propertyId],
      ...requestKeys(),
    ]);
  }
  if (payload.event.startsWith('audit.')) {
    return uniqueKeys([
      ['audit'],
      ['audit', propertyId],
      ['reports'],
      ['reports', propertyId],
      ...requestKeys(),
    ]);
  }
  if (payload.event === 'guest.communication_sent') {
    return uniqueKeys([
      ['communications'],
      ['communications', propertyId],
      ...requestKeys(),
    ]);
  }
  if (payload.event.startsWith('room.')) {
    return [['rooms'], ['rooms', propertyId], ['housekeeping'], ['housekeeping', propertyId]];
  }
  if (payload.event.startsWith('housekeeping.')) {
    return [['housekeeping'], ['housekeeping', propertyId], ['rooms'], ['rooms', propertyId]];
  }
  if (payload.event.startsWith('channel.')) return [['channels'], ['channels', propertyId]];
  if (payload.event.startsWith('agent.')) {
    return [
      ['agents'], ['agents', propertyId],
      ['agent-decisions'], ['agent-decisions', propertyId],
      ['agent-performance'], ['agent-performance', propertyId],
    ];
  }
  if (payload.event.startsWith('guest.')) {
    return [['agent-decisions'], ['agent-decisions', propertyId], ['reviews'], ['reviews', propertyId]];
  }
  if (payload.event.startsWith('connect.')) return [['connect'], ['connect', propertyId]];
  return [];
}

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const { propertyId, isPortfolioMode } = useProperty();
  const activePropertyId = isPortfolioMode ? null : propertyId;

  useEffect(() => {
    const socket = getSocket();

    function handleEvent(payload: PmsEventPayload) {
      if (!payload?.event) return;
      for (const key of realtimeQueryKeys(activePropertyId, payload)) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }

    socket.on('pmsEvent', handleEvent);
    return () => {
      socket.off('pmsEvent', handleEvent);
    };
  }, [activePropertyId, queryClient]);
}
