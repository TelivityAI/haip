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
        status: 'outcomeUnknown',
        sent: false,
        provider: 'smtp',
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

  it('hard-closes an active SMTP transaction before a later send can connect', async () => {
    const sockets = new Set<Socket>();
    const heartbeats = new Map<Socket, ReturnType<typeof setInterval>>();
    let sessionsAtData = 0;
    let maxConcurrentConnections = 0;
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      sockets.add(socket);
      maxConcurrentConnections = Math.max(maxConcurrentConnections, sockets.size);
      let input = '';
      let readingData = false;

      socket.write('220 smtp.test ESMTP ready\r\n');
      socket.on('data', (chunk) => {
        input += chunk.toString('utf8');
        if (readingData) {
          const dataEnd = input.indexOf('\r\n.\r\n');
          if (dataEnd < 0) return;
          input = input.slice(dataEnd + 5);
          readingData = false;
          sessionsAtData += 1;
          const heartbeat = setInterval(() => {
            if (!socket.destroyed && socket.writable) socket.write(' ');
          }, 5);
          heartbeats.set(socket, heartbeat);
          return;
        }

        let lineEnd: number;
        while ((lineEnd = input.indexOf('\r\n')) >= 0) {
          const command = input.slice(0, lineEnd);
          input = input.slice(lineEnd + 2);
          if (/^EHLO /i.test(command)) {
            socket.write('250-smtp.test\r\n250 PIPELINING\r\n');
          } else if (/^MAIL FROM:/i.test(command) || /^RCPT TO:/i.test(command)) {
            socket.write('250 2.1.0 Ok\r\n');
          } else if (/^DATA$/i.test(command)) {
            readingData = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
            if (input.includes('\r\n.\r\n')) {
              socket.emit('data', Buffer.alloc(0));
            }
            break;
          } else if (/^QUIT$/i.test(command)) {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
          }
        }
      });
      socket.on('error', () => undefined);
      socket.on('close', () => {
        sockets.delete(socket);
        const heartbeat = heartbeats.get(socket);
        if (heartbeat) clearInterval(heartbeat);
        heartbeats.delete(socket);
      });
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
    const send = (suffix: string) => provider.send({
      to: 'guest@example.com',
      subject: `Hi ${suffix}`,
      html: '<p>Hi</p>',
      text: 'Hi',
      messageId: `<stable-delivery-${suffix}@haip.local>`,
    }, { timeoutMs: 50 });

    try {
      for (const suffix of ['one', 'two']) {
        const result = await Promise.race([
          send(suffix),
          new Promise<typeof didNotSettle>((resolve) => {
            setTimeout(() => resolve(didNotSettle), 500);
          }),
        ]);

        expect(result).not.toBe(didNotSettle);
        expect(result).toMatchObject({
          status: 'outcomeUnknown',
          sent: false,
          provider: 'smtp',
          error: 'Email transport timed out',
        });
        await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 500 });
      }
      expect(sessionsAtData).toBe(2);
      expect(maxConcurrentConnections).toBe(1);
    } finally {
      for (const heartbeat of heartbeats.values()) clearInterval(heartbeat);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('returns at the deadline without cancelling the scheduled late close', async () => {
    const sockets = new Set<Socket>();
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      sockets.add(socket);
      let input = '';
      let readingData = false;

      socket.write('220 smtp.test ESMTP ready\r\n');
      socket.on('data', (chunk) => {
        input += chunk.toString('utf8');
        if (readingData) return;

        let lineEnd: number;
        while ((lineEnd = input.indexOf('\r\n')) >= 0) {
          const command = input.slice(0, lineEnd);
          input = input.slice(lineEnd + 2);
          if (/^EHLO /i.test(command)) {
            socket.write('250-smtp.test\r\n250 PIPELINING\r\n');
          } else if (/^MAIL FROM:/i.test(command) || /^RCPT TO:/i.test(command)) {
            socket.write('250 2.1.0 Ok\r\n');
          } else if (/^DATA$/i.test(command)) {
            readingData = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
            break;
          }
        }
      });
      socket.on('error', () => undefined);
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
    const clearImmediateSpy = vi.spyOn(global, 'clearImmediate');

    try {
      const result = await provider.send({
        to: 'guest@example.com',
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
      }, { timeoutMs: 50 });
      expect(result.status).toBe('outcomeUnknown');
      expect(clearImmediateSpy).not.toHaveBeenCalled();
    } finally {
      clearImmediateSpy.mockRestore();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
