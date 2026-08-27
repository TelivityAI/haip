import { BadRequestException } from '@nestjs/common';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Enumerate the exact canonical nights consumed by [checkIn, checkOut). */
export function stayDates(checkIn: string, checkOut: string): string[] {
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    throw new BadRequestException('Stay dates must use YYYY-MM-DD');
  }
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== checkIn
    || end.toISOString().slice(0, 10) !== checkOut
    || end <= start
  ) {
    throw new BadRequestException('Check-out must be after check-in');
  }

  const dates: string[] = [];
  for (let date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
