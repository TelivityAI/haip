import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, raw } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { securityHeaders } from './common/http/security-headers';
import { assertSecureConfig } from './common/config/assert-secure-config';

function corsOrigins(): boolean | string[] {
  const raw = process.env['CORS_ORIGINS'];
  if (!raw || raw.trim() === '') {
    // No allowlist configured: in production default to same-origin only (no
    // cross-origin); in dev allow everything for convenience.
    return process.env['NODE_ENV'] === 'production' ? [] : true;
  }
  if (raw.trim() === '*') return true;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

async function bootstrap() {
  assertSecureConfig();

  const app = await NestFactory.create(AppModule);

  // Security response headers (helmet-equivalent defaults).
  app.use(securityHeaders());

  // Stripe webhook signature verification requires the exact raw request body.
  // Install raw-body middleware for the webhook path BEFORE the global JSON
  // parser so req.body is a Buffer for that route; every other route still
  // receives parsed JSON.
  app.use('/api/v1/webhooks/stripe', raw({ type: 'application/json' }));
  app.use(json());

  // Global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // Validation pipe for DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Map unhandled (non-HTTP) errors to a generic 500 — no stack/SQL leakage.
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS — explicit allowlist from CORS_ORIGINS (no longer wide-open).
  app.enableCors({ origin: corsOrigins(), credentials: true });

  // OpenAPI / Swagger
  const config = new DocumentBuilder()
    .setTitle('HAIP — Hotel AI Platform')
    .setDescription(
      'Open-source, API-first hotel Property Management System. ' +
      'Part of Telivity\'s open-source travel infrastructure.',
    )
    .setVersion('0.0.1')
    .addBearerAuth()
    .addTag('properties', 'Property management')
    .addTag('rooms', 'Room inventory and status')
    .addTag('room-types', 'Room type definitions')
    .addTag('reservations', 'Reservation lifecycle')
    .addTag('guests', 'Guest profiles')
    .addTag('media', 'Images for properties, room types, and rooms')
    .addTag('admin', 'Users, roles, and permissions (local authz)')
    .addTag('folios', 'Billing and charges')
    .addTag('payments', 'Payment processing')
    .addTag('rate-plans', 'Rate plans and restrictions')
    .addTag('housekeeping', 'Housekeeping tasks')
    .addTag('health', 'System health checks')
    .build();

  // Expose the Swagger UI everywhere except production (it maps the full API
  // surface for an attacker). The public demo can opt back in with SWAGGER_ENABLED=true.
  const serveDocs =
    process.env['NODE_ENV'] !== 'production' || process.env['SWAGGER_ENABLED'] === 'true';
  if (serveDocs) {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);

  console.log(`HAIP API running on http://localhost:${port}`);
  if (serveDocs) console.log(`OpenAPI docs at http://localhost:${port}/docs`);
}

bootstrap();
