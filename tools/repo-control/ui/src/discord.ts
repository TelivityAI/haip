/**
 * Discord Activity bootstrap — primary product surface.
 * When embedded in Discord, force view-only and init Embedded App SDK.
 * Direct browser hits to the Activity origin are unsupported for normal use.
 */

const READY_TIMEOUT_MS = 4000;

function detectDiscordFrame(): boolean {
  const params = new URLSearchParams(location.search);
  const forceView = params.get('viewOnly') === '1' || params.get('discord') === '1';
  return (
    forceView ||
    location.hostname.endsWith('discordsays.com') ||
    params.has('frame_id') ||
    params.has('instance_id') ||
    params.has('platform') ||
    Boolean((window as unknown as { DiscordSDK?: unknown }).DiscordSDK)
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function initDiscordActivity(): Promise<{ viewOnly: boolean; inDiscord: boolean }> {
  const inDiscordFrame = detectDiscordFrame();

  if (!inDiscordFrame) {
    return { viewOnly: false, inDiscord: false };
  }

  document.documentElement.dataset.discord = 'pending';

  try {
    let clientId = (import.meta as ImportMeta & { env: Record<string, string> }).env
      ?.VITE_DISCORD_CLIENT_ID;
    if (!clientId) {
      try {
        const cfg = (await fetch('/api/public-config?discord=1').then((r) => r.json())) as {
          discordClientId?: string | null;
        };
        clientId = cfg.discordClientId || undefined;
      } catch {
        /* ignore */
      }
    }
    if (!clientId) {
      document.documentElement.dataset.discord = 'view-only-no-sdk';
      return { viewOnly: true, inDiscord: true };
    }

    const mod = await import('@discord/embedded-app-sdk');
    const discordSdk = new mod.DiscordSDK(clientId);
    // ready() can hang forever if the client id / parent bridge mismatches — never block the board
    await withTimeout(discordSdk.ready(), READY_TIMEOUT_MS, 'DiscordSDK.ready');
    document.documentElement.dataset.discord = 'activity';
    return { viewOnly: true, inDiscord: true };
  } catch (err) {
    console.warn('Discord SDK init failed; continuing view-only', err);
    document.documentElement.dataset.discord = 'view-only-sdk-failed';
    return { viewOnly: true, inDiscord: true };
  }
}

/** True when we should tag API reads for Discord public-read on the origin. */
export function isDiscordSurface(): boolean {
  return (
    document.documentElement.dataset.discord !== undefined ||
    detectDiscordFrame()
  );
}
