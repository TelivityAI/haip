import { createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmtpEmailProvider } from './smtp-email.provider';

describe('SmtpEmailProvider bounded send', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('settles and closes a connection that never sends its SMTP greeting', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('SMTP test server did not bind');
    process.env['SMTP_HOST'] = '127.0.0.1';
    process.env['SMTP_PORT'] = String(address.port);
    delete process.env['SMTP_USER'];
    delete process.env['SMTP_PASS'];
    const provider = new SmtpEmailProvider();
    const didNotSettle = Symbol('did-not-settle');

    try {
      const result = await Promise.race([
        provider.send({
          to: 'guest@example.com',
          subject: 'Hi',
          html: '<p>Hi</p>',
          text: 'Hi',
          messageId: '<stable-delivery@haip.local>',
        }, { timeoutMs: 50 }),
        new Promise<typeof didNotSettle>((resolve) => {
          setTimeout(() => resolve(didNotSettle), 500);
        }),
      ]);

      expect(result).not.toBe(didNotSettle);
      expect(result).toMatchObject({
        sent: false,
        provider: 'smtp',
        outcomeUnknown: true,
        error: 'Email transport timed out',
      });
      await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 500 });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
