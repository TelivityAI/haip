import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { shouldRetryQuery } from './queryClient';
import { requirePropertyId } from './api-helpers';

function failure(status: number): AxiosError {
  const error = new AxiosError('request failed');
  error.response = { status, statusText: '', data: {}, headers: {}, config: { headers: new AxiosHeaders() } };
  return error;
}
describe('request failures', () => {
  it.each([400, 401, 403, 404, 409, 422])('does not retry permanent HTTP %s failures', status => {
    expect(shouldRetryQuery(0, failure(status))).toBe(false);
  });
  it.each([408, 429, 500, 502, 503])('retries transient HTTP %s once', status => {
    expect(shouldRetryQuery(0, failure(status))).toBe(true);
    expect(shouldRetryQuery(1, failure(status))).toBe(false);
  });
  it('retries a network failure once', () => {
    expect(shouldRetryQuery(0, new AxiosError('offline'))).toBe(true);
    expect(shouldRetryQuery(1, new AxiosError('offline'))).toBe(false);
  });
  it('rejects a portfolio sentinel in property write helpers', () => {
    expect(() => requirePropertyId('portfolio')).toThrow('Select a property first');
    expect(() => requirePropertyId('property-a')).not.toThrow();
  });
});
