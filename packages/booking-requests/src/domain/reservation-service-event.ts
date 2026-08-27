/**
 * Package-local copy of apps/api's
 * `apps/api/src/modules/ancillary/reservation-service-event.ts` — fully
 * self-contained pure payload shaping, duplicated here rather than imported
 * so this package never imports from apps/api.
 */
export interface ReservationServiceAttachedRow {
  reservationId: string;
  serviceId: string;
  quantity: number;
  unitPrice: string;
  postingRule: string;
  sourceChannel: string;
}

export function reservationServiceAttachedPayload(
  row: ReservationServiceAttachedRow,
  serviceName: string,
) {
  return {
    reservationId: row.reservationId,
    serviceId: row.serviceId,
    serviceName,
    sourceChannel: row.sourceChannel,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    postingRule: row.postingRule,
  };
}
