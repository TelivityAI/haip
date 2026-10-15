import { spawn } from 'node:child_process';

export interface ExecResult {
  ok: boolean;
  timedOut: boolean;
  unavailable: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function runCommand(
  command: string,
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, CI: process.env.CI ?? 'true' },
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, opts.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        timedOut: false,
        unavailable: true,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        durationMs: Date.now() - started,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        timedOut,
        unavailable: false,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await runCommand(`git ${args.map(shellQuote).join(' ')}`, {
    cwd,
    timeoutMs: 30_000,
  });
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9_./@%+=:,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
