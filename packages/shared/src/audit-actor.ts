/** Who performed an audited action + from where. All optional (null in AUTH-off demo). */
export interface AuditActor {
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
}

/** Map an AuditActor to the auditLogs actor columns (always defined, possibly null). */
export function actorFields(actor?: AuditActor): {
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
} {
  return {
    userId: actor?.userId ?? null,
    userEmail: actor?.userEmail ?? null,
    ipAddress: actor?.ipAddress ?? null,
  };
}
