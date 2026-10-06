import { QueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  const status = isAxiosError(error) ? error.response?.status : undefined;
  // Validation, missing routes and denied access do not improve with a retry.
  return status === undefined || status >= 500 || status === 408 || status === 429;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: shouldRetryQuery,
    },
  },
});
