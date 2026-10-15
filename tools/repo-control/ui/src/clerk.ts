/**
 * Clerk browser auth for hosted contributor access (email sign-up / sign-in).
 * Discord Activity path does not use Clerk.
 */

export type ClerkSession = {
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  email: string | null;
  userId: string;
};

type PublicConfig = {
  clerk: { enabled: boolean; publishableKey: string | null };
  discordClientId: string | null;
};

let bearerToken: string | null = null;
let session: ClerkSession | null = null;

export function getClerkBearer(): string | null {
  return bearerToken;
}

export function getClerkSession(): ClerkSession | null {
  return session;
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await fetch('/api/public-config');
  if (!res.ok) {
    return { clerk: { enabled: false, publishableKey: null }, discordClientId: null };
  }
  return res.json() as Promise<PublicConfig>;
}

export async function ensureClerkSignedIn(
  mountEl: HTMLElement,
): Promise<{ ok: boolean; viewOnly: boolean; error?: string }> {
  const cfg = await fetchPublicConfig();
  if (!cfg.clerk.enabled || !cfg.clerk.publishableKey) {
    return { ok: false, viewOnly: true, error: 'clerk_disabled' };
  }

  try {
    const { Clerk } = await import('@clerk/clerk-js');
    const clerk = new Clerk(cfg.clerk.publishableKey);
    await clerk.load();

    if (!clerk.user) {
      mountEl.innerHTML = `
        <div class="login" style="max-width:420px">
          <h1>Telivity</h1>
          <p>Repository Control — contributor access</p>
          <p style="color:var(--muted);font-size:12px;margin:8px 0 12px">
            Sign up or sign in with your email to read the report. Free. View-only.
          </p>
          <div id="clerk-mount"></div>
        </div>`;
      const mount = document.getElementById('clerk-mount');
      if (!mount) return { ok: false, viewOnly: true, error: 'mount_missing' };
      clerk.mountSignIn(mount, {
        routing: 'hash',
        signUpUrl: '#/sign-up',
        forceRedirectUrl: window.location.href.split('#')[0],
        signUpForceRedirectUrl: window.location.href.split('#')[0],
      });
      // Also support hash sign-up path
      if (location.hash.includes('sign-up')) {
        mount.innerHTML = '';
        clerk.mountSignUp(mount, {
          routing: 'hash',
          signInUrl: '#/',
          forceRedirectUrl: window.location.href.split('#')[0],
        });
      }
      clerk.addListener(async (res) => {
        if (res.user) {
          location.hash = '';
          location.reload();
        }
      });
      return { ok: false, viewOnly: true, error: 'needs_sign_in' };
    }

    bearerToken = (await clerk.session?.getToken()) ?? null;
    session = {
      userId: clerk.user.id,
      email:
        clerk.user.primaryEmailAddress?.emailAddress ??
        clerk.user.emailAddresses[0]?.emailAddress ??
        null,
      getToken: async () => {
        bearerToken = (await clerk.session?.getToken()) ?? null;
        return bearerToken;
      },
      signOut: async () => {
        await clerk.signOut();
        bearerToken = null;
        session = null;
        location.reload();
      },
    };

    return { ok: true, viewOnly: true };
  } catch (err) {
    return {
      ok: false,
      viewOnly: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
