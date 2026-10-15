/**
 * Discord Activity bootstrap.
 * When running inside Discord's iframe, Embedded App SDK is available.
 * Outside Discord, this is a no-op and the browser private UI is used.
 */

export async function initDiscordActivity(): Promise<{ viewOnly: boolean; inDiscord: boolean }> {
  const params = new URLSearchParams(location.search);
  const forceView = params.get('viewOnly') === '1' || params.get('discord') === '1';

  // Heuristic: Discord Activities load under discordsays.com or with frame_id
  const inDiscordFrame =
    forceView ||
    location.hostname.endsWith('discordsays.com') ||
    params.has('frame_id') ||
    Boolean((window as unknown as { DiscordSDK?: unknown }).DiscordSDK);

  if (!inDiscordFrame) {
    return { viewOnly: false, inDiscord: false };
  }

  try {
    const clientId = (import.meta as ImportMeta & { env: Record<string, string> }).env
      ?.VITE_DISCORD_CLIENT_ID;
    if (!clientId) {
      // Still treat as view-only when embedded without SDK config
      document.documentElement.dataset.discord = 'view-only-no-sdk';
      return { viewOnly: true, inDiscord: true };
    }

    const mod = await import('@discord/embedded-app-sdk');
    const discordSdk = new mod.DiscordSDK(clientId);
    await discordSdk.ready();
    // Authorize is optional for view-only status boards; skip mutating commands.
    document.documentElement.dataset.discord = 'activity';
    return { viewOnly: true, inDiscord: true };
  } catch (err) {
    console.warn('Discord SDK init failed; continuing view-only', err);
    return { viewOnly: true, inDiscord: true };
  }
}
