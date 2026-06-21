/**
 * Door-lock / access-control provider abstraction.
 *
 * HAIP ships the interface + a webhook reference adapter. A self-hoster points
 * the webhook at their lock vendor (Salto, Assa Abloy, Dormakaba, …) or swaps in
 * a vendor-specific adapter. The PMS never embeds vendor SDKs.
 */
export interface AccessCredentialRequest {
  propertyId: string;
  reservationId: string;
  roomId?: string | null;
  /** ISO timestamps bounding when the credential is valid. */
  validFrom?: string;
  validTo?: string;
}

export interface AccessCredential {
  provider: string;
  credentialId: string;
  /** Optional human-presentable code (PIN) for keypad locks. */
  accessCode?: string;
}

export interface LockProvider {
  readonly name: string;
  /** Provision room access for a checked-in reservation. */
  issueCredential(req: AccessCredentialRequest): Promise<AccessCredential>;
  /** Revoke access at check-out. */
  revokeCredential(req: { propertyId: string; reservationId: string; roomId?: string | null }): Promise<void>;
}

export const LOCK_PROVIDER = Symbol('LOCK_PROVIDER');
