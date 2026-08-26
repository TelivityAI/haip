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
