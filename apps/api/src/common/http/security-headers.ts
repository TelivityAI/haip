import type { Request, Response, NextFunction } from 'express';

/**
 * Minimal security-response-headers middleware (dependency-free stand-in for
 * helmet's defaults). Sets the headers that matter for a JSON API serving a
 * bundled SPA: no MIME sniffing, deny framing, referrer privacy, and HSTS in
 * production. Kept small and explicit so it's easy to audit.
 */
export function securityHeaders() {
  const isProd = process.env['NODE_ENV'] === 'production';
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.removeHeader('X-Powered-By');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}
