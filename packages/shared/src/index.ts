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
  'reservation.pre_registered': 'reservation.pre_registered',
  'reservation.checked_out': 'reservation.checked_out',
  'reservation.no_show': 'reservation.no_show',
  'reservation.note_added': 'reservation.note_added',
  'reservation.message_sent': 'reservation.message_sent',
  'reservation.bulk_action_completed': 'reservation.bulk_action_completed',
  'reservation.room_moved': 'reservation.room_moved',
  'reservation.guest_added': 'reservation.guest_added',
  'reservation.guest_removed': 'reservation.guest_removed',
  'reservation.guest_moved': 'reservation.guest_moved',
  'reservation.split': 'reservation.split',

  // Folio events
  'folio.created': 'folio.created',
  'folio.charge_posted': 'folio.charge_posted',
  'folio.settled': 'folio.settled',

  // Payment events
  'payment.received': 'payment.received',
  'payment.refunded': 'payment.refunded',
  'payment.failed': 'payment.failed',

  // Fiscal document / invoice events (regional tax integrations).
  // Core stores only a document reference on the folio; issuance is performed
  // by external integrations subscribed to invoice.requested.
  'invoice.requested': 'invoice.requested',
  'invoice.issued': 'invoice.issued',
  'invoice.voided': 'invoice.voided',

  // Room events
  'room.status_changed': 'room.status_changed',

  // Housekeeping events
  'housekeeping.task_assigned': 'housekeeping.task_assigned',
  'housekeeping.task_completed': 'housekeeping.task_completed',

  // Night audit events
  'audit.started': 'audit.started',
  'audit.completed': 'audit.completed',

  // Accounting export events
  'accounting.export.ready': 'accounting.export.ready',

  // Staff notification events
  'staff.notification_created': 'staff.notification_created',

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

  // Stay extras / ancillary services
  'service.created': 'service.created',
  'service.updated': 'service.updated',
  'reservation.service_attached': 'reservation.service_attached',
  'reservation.service_cancelled': 'reservation.service_cancelled',
  'reservation.service_posted': 'reservation.service_posted',

  // Cancellation policies
  'cancellation_policy.created': 'cancellation_policy.created',
  'cancellation_policy.updated': 'cancellation_policy.updated',
  'cancellation_policy.deleted': 'cancellation_policy.deleted',

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

  // Rate / restriction changes (drive channel ARI delta pushes)
  'rate_plan.updated': 'rate_plan.updated',
  'rate_restriction.created': 'rate_restriction.created',
  'rate_restriction.updated': 'rate_restriction.updated',
  'rate_restriction.deleted': 'rate_restriction.deleted',

  // Channel content events (descriptive content: photos, descriptions, amenities)
  'property.content_updated': 'property.content_updated',
  'roomtype.content_updated': 'roomtype.content_updated',

  // Door-lock / access-control events (outbound to lock vendors)
  'door.access_granted': 'door.access_granted',
  'door.access_revoked': 'door.access_revoked',
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

/**
 * Brazilian FNRH (Ficha Nacional de Cadastro de Hóspedes) — Ministry of Tourism / Embratur Standards
 */

export const FNRH_TRAVEL_REASONS = [
  'leisure',      // Lazer / Férias
  'business',     // Negócios / Convenção
  'congress',     // Congresso / Feira
  'relatives',    // Parentes / Amigos
  'studies',      // Estudos / Cursos
  'health',       // Saúde
  'shopping',     // Compras
  'other',        // Outro
] as const;

export type FnrhTravelReason = (typeof FNRH_TRAVEL_REASONS)[number];

export const FNRH_TRANSPORT_MODES = [
  'plane',        // Avião
  'car',          // Automóvel
  'bus',          // Ônibus
  'motorcycle',   // Moto
  'train',        // Trem
  'ship',         // Navio / Barco
  'other',        // Outro
] as const;

export type FnrhTransportMode = (typeof FNRH_TRANSPORT_MODES)[number];

/** Jurisdiction-specific guest registration data for Brazilian FNRH */
export interface FnrhGuestData {
  cpf?: string;
  idIssuer?: string;      // Órgão Expedidor (e.g. SSP)
  idIssuerState?: string; // UF Expedidora (e.g. SP)
  neighborhood?: string;  // Bairro
  profession?: string;    // Profissão / Ocupação
  gender?: string;        // "male" | "female" | "other"
}

/** Stay-specific FNRH details captured during check-in / pre-registration */
export interface FnrhStayData {
  travelReason?: FnrhTravelReason | string;
  transportationMode?: FnrhTransportMode | string;
  lastOriginCity?: string;
  lastOriginState?: string;
  lastOriginCountry?: string;
  nextDestinationCity?: string;
  nextDestinationState?: string;
  nextDestinationCountry?: string;
}

/**
 * Validates Brazilian CPF number algorithmically (11 digits with check digits).
 */
export function validateCpf(cpfRaw?: string | null): boolean {
  if (!cpfRaw) return false;
  const clean = cpfRaw.replace(/\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(9), 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(10), 10)) return false;

  return true;
}

/** Formats an 11-digit CPF string into 000.000.000-00 */
export function formatCpf(cpfRaw?: string | null): string {
  if (!cpfRaw) return '';
  const clean = cpfRaw.replace(/\D/g, '');
  if (clean.length !== 11) return cpfRaw;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

/** Calculates age in years from date string or Date object */
export function calculateAge(dobInput?: string | Date | null): number | null {
  if (!dobInput) return null;
  const dob = typeof dobInput === 'string' ? new Date(dobInput) : dobInput;
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/** Evaluates whether a guest record contains required Brazilian FNRH fields */
export function checkFnrhComplete(
  guest: Record<string, any>,
  minorGuardianRequired = true,
): boolean {
  if (!guest) return false;
  const reg = (guest['registrationData'] as Record<string, any>) || {};
  const hasCpfOrDoc = Boolean(guest['taxId'] || guest['idNumber']);
  const hasName = Boolean(guest['firstName'] && guest['lastName']);
  const hasGender = Boolean(guest['gender'] || reg['gender']);

  const age = calculateAge(guest['dateOfBirth']);
  const isMinor = (age !== null && age < 18) || Boolean(reg['isMinor']);
  const guardianOk = !isMinor || !minorGuardianRequired || Boolean(reg['guardianName'] && reg['guardianTaxId']);

  return Boolean(hasName && hasCpfOrDoc && hasGender && guardianOk);
}

/** Legacy alias for checkFnrhComplete */
export const isFnrhComplete = checkFnrhComplete;

