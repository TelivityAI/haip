import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'GET', url: '/x' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('passes through HttpExceptions with their status', () => {
    const { host, res } = makeHost();
    filter.catch(new BadRequestException('bad input'), host);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('maps unknown errors to a generic 500 (no stack/detail leaked)', () => {
    const { host, res } = makeHost();
    filter.catch(new Error('ECONNREFUSED postgres at 10.0.0.5:5432 — secret detail'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });
});
