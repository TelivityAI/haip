import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from './Toast';

function ToastTrigger({ type, message }: { type: 'success' | 'error' | 'info'; message: string }) {
  const { toast } = useToast();
  return <button onClick={() => toast(type, message)}>Show Toast</button>;
}

describe('Toast', () => {
  it('shows success toast when triggered', async () => {
    render(
      <ToastProvider>
        <ToastTrigger type="success" message="Check-in successful" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Check-in successful')).toBeInTheDocument();
  });

  it('shows error toast when triggered', async () => {
    render(
      <ToastProvider>
        <ToastTrigger type="error" message="Failed to save" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Failed to save')).toBeInTheDocument();
  });

  it('dismisses toast when X clicked', async () => {
    render(
      <ToastProvider>
        <ToastTrigger type="info" message="Processing..." />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Processing...')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
  });

  it('auto-dismisses after timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <ToastTrigger type="success" message="Auto dismiss" />
      </ToastProvider>,
    );
    await user.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Auto dismiss')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText('Auto dismiss')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('pauses timeout on hover', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <ToastTrigger type="success" message="Hover test" />
      </ToastProvider>,
    );
    await user.click(screen.getByText('Show Toast'));
    const toastEl = screen.getByRole('alert');
    expect(screen.getByText('Hover test')).toBeInTheDocument();

    // Advance 2000ms (halfway to 4000ms timeout)
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('Hover test')).toBeInTheDocument();

    // Hover over the toast item to pause timeout
    await user.hover(toastEl);

    // Advance another 3000ms (would have expired at 4000ms total if not paused)
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('Hover test')).toBeInTheDocument();

    // Unhover the toast item to resume timeout
    await user.unhover(toastEl);

    // Advance the remaining 2000ms — should dismiss after resume
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText('Hover test')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders countdown progress bar that updates over time and pauses on hover', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <ToastTrigger type="info" message="Progress bar test" />
      </ToastProvider>,
    );
    await user.click(screen.getByText('Show Toast'));

    const bar = screen.getByRole('progressbar', { name: /toast timeout/i });
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '100');

    // Advance 2000ms (halfway)
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(bar).toHaveAttribute('aria-valuenow', '50');

    // Hover over toast to pause progress bar
    await user.hover(screen.getByRole('alert'));
    await act(async () => { vi.advanceTimersByTime(1000); });
    // Should stay paused at 50
    expect(bar).toHaveAttribute('aria-valuenow', '50');

    vi.useRealTimers();
  });
});
