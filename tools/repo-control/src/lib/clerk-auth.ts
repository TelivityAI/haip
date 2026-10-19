import http from 'node:http';
import { createClerkClient, verifyToken } from '@clerk/backend';

export interface ClerkIdentity {
  userId: string;
  email: string | null;
  isOwner: boolean;
}

const secretKey = () => process.env.CLERK_SECRET_KEY || '';
const publishableKey = () =>
  process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || '';

export function clerkEnabled(): boolean {
  return Boolean(secretKey() && publishableKey());
}

export function publicClerkConfig(): { enabled: boolean; publishableKey: string | null } {
  return {
    enabled: clerkEnabled(),
    publishableKey: publishableKey() || null,
  };
}

function ownerEmails(): Set<string> {
  return new Set(
    (process.env.REPO_CONTROL_OWNER_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function ownerUserIds(): Set<string> {
  return new Set(
    (process.env.REPO_CONTROL_OWNER_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function resolveClerkIdentity(
  req: http.IncomingMessage,
): Promise<ClerkIdentity | null> {
  if (!clerkEnabled()) return null;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    const payload = await verifyToken(token, { secretKey: secretKey() });
    const userId = payload.sub;
    if (!userId) return null;

    let email: string | null = null;
    const claimEmail = (payload as { email?: unknown; primary_email_address?: unknown }).email;
    const claimPrimary = (payload as { primary_email_address?: unknown }).primary_email_address;
    if (typeof claimEmail === 'string') email = claimEmail;
    else if (typeof claimPrimary === 'string') email = claimPrimary;

    // Resolve email from Clerk API when not in JWT (needed for owner allowlist)
    if (!email && ownerEmails().size > 0) {
      try {
        const client = createClerkClient({ secretKey: secretKey() });
        const user = await client.users.getUser(userId);
        email =
          user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
          user.emailAddresses[0]?.emailAddress ??
          null;
      } catch {
        /* ignore */
      }
    }

    const isOwner =
      ownerUserIds().has(userId) ||
      (email ? ownerEmails().has(email.toLowerCase()) : false);

    return { userId, email, isOwner };
  } catch {
    return null;
  }
}
