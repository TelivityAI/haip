/**
 * Shared ephemeral-Postgres-database helpers for the release-gate regression
 * specs in this directory (see booking-request-default-flow-regression.spec.ts
 * and booking-request-flag-off-instant-booking.regression.spec.ts). Each spec
 * provisions its own scratch database against the same DATABASE_URL host so
 * the two regression suites never collide with each other or with `haip_test`.
 *
 * Extracted so the flag-off regression spec does not have to re-duplicate the
 * subprocess-sanitization logic (createdb/dropdb via psql utilities, with a
 * Docker-exec fallback for containerized Postgres, and credential redaction
 * on failure).
 */
import { execFileSync } from 'node:child_process';

export const DATABASE_UTILITY_TIMEOUT_MS = 30_000;

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function createRegressionDatabaseHelpers(connectionTemplate: string) {
  function databaseUrlFor(databaseName: string): string {
    const url = new URL(connectionTemplate);
    url.pathname = `/${databaseName}`;
    return url.toString();
  }

  function sanitizeDiagnostic(value: string, secret: string): string {
    const structurallySanitized = value
      .replace(/\b(postgres(?:ql)?:\/\/)[^\s/?#@]*@/gi, '$1')
      .replace(
        /\b(password\s*=\s*)(?:'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|(?:\\[\s\S]|[^\s])+)/gi,
        '$1[redacted]',
      );
    const sensitiveValues = [
      secret,
      encodeURIComponent(secret),
      connectionTemplate,
      databaseUrlFor('postgres'),
    ].filter(Boolean);
    return sensitiveValues.reduce(
      (sanitized, sensitive) => sanitized.replaceAll(sensitive, '[redacted]'),
      structurallySanitized,
    ).slice(-2_000);
  }

  function sanitizedChildError(label: string, error: unknown, secret: string): Error {
    const childError = error as {
      code?: string | number;
      message?: string;
      status?: number | null;
      signal?: NodeJS.Signals | null;
      stderr?: Buffer | string;
    };
    const rawDetail = childError.stderr?.toString().trim()
      || childError.message?.trim()
      || '';
    const detail = sanitizeDiagnostic(rawDetail, secret);
    const rawOutcome = childError.signal
      ? `signal ${childError.signal}`
      : childError.status !== undefined && childError.status !== null
        ? `exit ${childError.status}`
        : childError.code !== undefined
          ? `code ${childError.code}`
          : 'exit unknown';
    const outcome = sanitizeDiagnostic(rawOutcome, secret);
    return new Error(`${label} failed (${outcome})${detail ? `: ${detail}` : ''}`);
  }

  function execFileBounded(
    command: string,
    args: string[],
    options: {
      env: NodeJS.ProcessEnv;
      label: string;
      secret: string;
      timeout: number;
      tolerateMissing?: boolean;
      cwd?: string;
    },
  ): Buffer | undefined {
    try {
      return execFileSync(command, args, {
        env: options.env,
        cwd: options.cwd,
        stdio: 'pipe',
        timeout: options.timeout,
      });
    } catch (error: unknown) {
      if (options.tolerateMissing && isMissingExecutable(error)) return undefined;
      throw sanitizedChildError(options.label, error, options.secret);
    }
  }

  function runDatabaseUtility(command: 'createdb' | 'dropdb', databaseName: string): void {
    const maintenanceUrl = new URL(connectionTemplate);
    maintenanceUrl.pathname = '/postgres';
    const databasePassword = decodeURIComponent(maintenanceUrl.password);
    const publicMaintenanceUrl = new URL(maintenanceUrl);
    publicMaintenanceUrl.password = '';
    const utilityArgs = [
      `--maintenance-db=${publicMaintenanceUrl.toString()}`,
      '--no-password',
      ...(command === 'dropdb' ? ['--if-exists', '--force'] : []),
      databaseName,
    ];
    const childEnv = { ...process.env, PGPASSWORD: databasePassword };
    const hostResult = execFileBounded(command, utilityArgs, {
      env: childEnv,
      label: `PostgreSQL ${command}`,
      secret: databasePassword,
      timeout: DATABASE_UTILITY_TIMEOUT_MS,
      tolerateMissing: true,
    });
    if (hostResult !== undefined) return;

    const host = maintenanceUrl.hostname;
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      throw new Error(
        `${command} is required to provision the remote PostgreSQL test database`,
      );
    }
    const publishedPort = maintenanceUrl.port || '5432';
    const containerOutput = execFileBounded('docker', [
      'ps',
      '--filter',
      `publish=${publishedPort}`,
      '--format',
      '{{.Names}}',
    ], {
      env: childEnv,
      label: 'PostgreSQL container lookup',
      secret: databasePassword,
      timeout: DATABASE_UTILITY_TIMEOUT_MS,
    });
    const containers = containerOutput!.toString().trim().split('\n').filter(Boolean);
    if (containers.length !== 1) {
      throw new Error(
        `${command} is unavailable and PostgreSQL container lookup for port ${publishedPort} `
        + `returned ${containers.length} matches`,
      );
    }
    execFileBounded('docker', [
      'exec',
      '--env',
      'PGPASSWORD',
      containers[0]!,
      command,
      '--username',
      decodeURIComponent(maintenanceUrl.username),
      '--maintenance-db',
      'postgres',
      '--no-password',
      ...(command === 'dropdb' ? ['--if-exists', '--force'] : []),
      databaseName,
    ], {
      env: childEnv,
      label: `containerized PostgreSQL ${command}`,
      secret: databasePassword,
      timeout: DATABASE_UTILITY_TIMEOUT_MS,
    });
  }

  return {
    databaseUrlFor,
    execFileBounded,
    runDatabaseUtility,
    sanitizedChildError,
    sanitizeDiagnostic,
  };
}
