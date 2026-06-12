/**
 * Vercel serverless entrypoint for the HAIP API.
 *
 * Boots the same NestJS AppModule as src/main.ts (same middleware, prefix, and
 * validation), but instead of listening on a port it hands Vercel the underlying
 * Express instance. The app is created once per lambda instance and reused
 * across invocations.
 *
 * Plain CommonJS (not TS) on purpose: it loads the compiled ../dist output, and
 * a JS entry avoids type-checking against dist files that ship no declarations.
 *
 * Differences from src/main.ts, deliberate for serverless:
 * - No Swagger UI (cold-start cost; the NestJS decorators are unaffected).
 * - No app.listen() — Vercel owns the HTTP server.
 * Long-lived features (socket.io events gateway, the webhook retry scheduler)
 * initialize but won't persist across invocations; the Connect API surface this
 * demo serves does not depend on them.
 */

const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { json, raw } = require('express');
const { AppModule } = require('../dist/app.module');

let cached;

async function createHandler() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  // Mirror src/main.ts: raw body for Stripe webhook signatures, JSON elsewhere.
  app.use('/api/v1/webhooks/stripe', raw({ type: 'application/json' }));
  app.use(json());

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();

  await app.init();
  return app.getHttpAdapter().getInstance();
}

module.exports = async function handler(req, res) {
  cached ??= createHandler();
  const expressApp = await cached;
  expressApp(req, res);
};
