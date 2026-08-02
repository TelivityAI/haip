/**
 * Pure planner for multi-guest walk-in room assignment.
 * Same room → accompanying on one reservation; new room → split under booking.
 */
export interface WalkInPlanOccupant {
  guestId: string;
  roomId: string;
}

export type WalkInPlanStep =
  | { type: 'create_primary'; guestId: string; roomId: string }
  | { type: 'add_accompanying'; guestId: string; roomId: string }
  | { type: 'split_new_room'; guestId: string; roomId: string };

export function planWalkInAssignments(occupants: WalkInPlanOccupant[]): WalkInPlanStep[] {
  if (occupants.length === 0) return [];
  const [primary, ...rest] = occupants;
  const steps: WalkInPlanStep[] = [
    { type: 'create_primary', guestId: primary.guestId, roomId: primary.roomId },
  ];
  const knownRooms = new Set<string>([primary.roomId]);

  for (const occupant of rest) {
    if (knownRooms.has(occupant.roomId)) {
      steps.push({
        type: 'add_accompanying',
        guestId: occupant.guestId,
        roomId: occupant.roomId,
      });
    } else {
      steps.push({
        type: 'split_new_room',
        guestId: occupant.guestId,
        roomId: occupant.roomId,
      });
      knownRooms.add(occupant.roomId);
    }
  }

  return steps;
}
