/**
 * Helpers for hotel-branded From / Reply-To without custom DNS.
 * Envelope address stays the verified platform sender; display name = property name.
 */

export function sanitizeDisplayName(name: string): string {
  return name.replace(/[\r\n"<>]/g, '').trim();
}

/** Format as `"Property Name" <noreply@platform>` for providers that accept a single From string. */
export function formatNamedFrom(displayName: string | undefined, address: string): string {
  const email = address.trim();
  if (!email) return email;
  const name = displayName ? sanitizeDisplayName(displayName) : '';
  if (!name) return email;
  return `"${name}" <${email}>`;
}

export function parseNamedFrom(from: string): { email: string; name?: string } {
  const trimmed = from.trim();
  const quoted = /^"([^"]*)"\s*<([^>]+)>$/.exec(trimmed);
  if (quoted?.[2]) {
    const name = quoted[1]?.trim();
    return { email: quoted[2].trim(), ...(name ? { name } : {}) };
  }
  const angle = /^([^<]*?)\s*<([^>]+)>$/.exec(trimmed);
  if (angle?.[2]) {
    const name = angle[1]?.trim();
    return { email: angle[2].trim(), ...(name ? { name } : {}) };
  }
  return { email: trimmed };
}

/** First configured platform From among common provider env vars. */
export function resolvePlatformFromAddress(): string | undefined {
  return (
    process.env['SENDGRID_FROM'] ||
    process.env['MAILGUN_FROM'] ||
    process.env['SES_FROM'] ||
    process.env['AWS_SES_FROM'] ||
    process.env['SMTP_FROM'] ||
    undefined
  );
}
