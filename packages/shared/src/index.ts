/**
 * HAIP Shared — Types, constants, and utilities shared across packages.
 */

/** Webhook event types following entity.action pattern */
export const WEBHOOK_EVENTS = {
  // Reservation events
  'reservation.created': 'reservation.created',
  'reservation.confirmed': 'reservation.confirmed',
  'reservation.modified': 'reservation.modified',
  'reservation.cancelled': 'reservation.cancelled',
  'reservation.checked_in': 'reservation.checked_in',
  'reservation.checked_out': 'reservation.checked_out',
  'reservation.no_show': 'reservation.no_show',
  'reservation.note_added': 'reservation.note_added',
  'reservation.message_sent': 'reservation.message_sent',
  'reservation.bulk_action_completed': 'reservation.bulk_action_completed',

  // Folio events
  'folio.created': 'folio.created',
  'folio.charge_posted': 'folio.charge_posted',
  'folio.settled': 'folio.settled',

  // Payment events
  'payment.received': 'payment.received',
  'payment.refunded': 'payment.refunded',
  'payment.failed': 'payment.failed',

  // Room events
  'room.status_changed': 'room.status_changed',

  // Housekeeping events
  'housekeeping.task_assigned': 'housekeeping.task_assigned',
  'housekeeping.task_completed': 'housekeeping.task_completed',

  // Night audit events
  'audit.started': 'audit.started',
  'audit.completed': 'audit.completed',

  // Channel manager events
  'channel.connected': 'channel.connected',
  'channel.disconnected': 'channel.disconnected',
  'channel.sync_completed': 'channel.sync_completed',
  'channel.sync_failed': 'channel.sync_failed',
  'channel.reservation_received': 'channel.reservation_received',

  // Connect/Agent events
  'connect.booking_created': 'connect.booking_created',
  'connect.booking_modified': 'connect.booking_modified',
  'connect.booking_cancelled': 'connect.booking_cancelled',
  'connect.subscription_created': 'connect.subscription_created',

  // AI Agent events
  'agent.run_completed': 'agent.run_completed',
  'agent.decision_created': 'agent.decision_created',
  'agent.decision_executed': 'agent.decision_executed',
  'agent.training_completed': 'agent.training_completed',
  'agent.cancellation_forecast_updated': 'agent.cancellation_forecast_updated',
  'rate.ai_adjusted': 'rate.ai_adjusted',
  'housekeeping.ai_assigned': 'housekeeping.ai_assigned',

  // Guest engagement events
  'guest.communication_drafted': 'guest.communication_drafted',
  'guest.communication_sent': 'guest.communication_sent',
  'guest.review_response_drafted': 'guest.review_response_drafted',

  // Deposit ledger events (KB 10)
  'deposit.received': 'deposit.received',
  'deposit.applied': 'deposit.applied',
  'deposit.refunded': 'deposit.refunded',
  'deposit.forfeited': 'deposit.forfeited',

  // Accounts Receivable events (KB 11)
  'ar.ledger_created': 'ar.ledger_created',
  'ar.transfer_created': 'ar.transfer_created',
  'ar.transfer_reversed': 'ar.transfer_reversed',
  'ar.payment_recorded': 'ar.payment_recorded',

  // Cash drawer / cashiering events (KB 12)
  'cashdrawer.session_opened': 'cashdrawer.session_opened',
  'cashdrawer.movement_recorded': 'cashdrawer.movement_recorded',
  'cashdrawer.session_closed': 'cashdrawer.session_closed',

  // House account events (KB 13)
  'houseaccount.opened': 'houseaccount.opened',
  'houseaccount.closed': 'houseaccount.closed',
  'houseaccount.charge_posted': 'houseaccount.charge_posted',
  'houseaccount.payment_recorded': 'houseaccount.payment_recorded',

  // Split-folio events (KB 14.2)
  'folio.transactions_moved': 'folio.transactions_moved',
  'folio.routing_rule_created': 'folio.routing_rule_created',

  // Payment correction matrix (KB 14.1)
  'payment.corrected': 'payment.corrected',

  // Groups & Allotment Engine (KB 14.3–14.7)
  'group.profile_created': 'group.profile_created',
  'group.block_created': 'group.block_created',
  'group.inventory_set': 'group.inventory_set',
  'group.block_released': 'group.block_released',
  'group.rooming_list_imported': 'group.rooming_list_imported',
  'group.reservation_linked': 'group.reservation_linked',

  // Channel content events (descriptive content: photos, descriptions, amenities)
  'property.content_updated': 'property.content_updated',
  'roomtype.content_updated': 'roomtype.content_updated',
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
