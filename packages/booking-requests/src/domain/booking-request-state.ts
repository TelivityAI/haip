import { ConflictException } from '@nestjs/common';

export type BookingRequestStatus = 'pending' | 'accepted' | 'denied';

/**
 * Booking Requests have one decision point. Accepted and denied are terminal;
 * payment progress is deliberately not part of this state machine.
 */
export function assertBookingRequestTransition(
  from: BookingRequestStatus,
  to: Exclude<BookingRequestStatus, 'pending'>,
): void {
  if (from !== 'pending') {
    throw new ConflictException(
      `Cannot transition booking request from '${from}' to '${to}'`,
    );
  }
}
