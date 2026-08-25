import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertyProvider, useProperty } from './PropertyContext';

const socketState = vi.hoisted(() => ({
  connectListeners: new Set<() => void>(),
  join: vi.fn(),
  leave: vi.fn(),
}));

vi.mock('../lib/socket', () => ({
  getSocket: () => ({
    on: (event: string, listener: () => void) => {
      if (event === 'connect') socketState.connectListeners.add(listener);
    },
    off: (event: string, listener: () => void) => {
      if (event === 'connect') socketState.connectListeners.delete(listener);
    },
  }),
  joinPropertyRoom: socketState.join,
  leavePropertyRoom: socketState.leave,
}));

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn((path: string) => Promise.resolve({
      data: path === '/v1/properties'
        ? [
          { id: 'property-1', name: 'One', currencyCode: 'EUR' },
          { id: 'property-2', name: 'Two', currencyCode: 'EUR' },
        ]
        : [],
    })),
  },
  setPropertyId: vi.fn(),
}));

function Probe() {
  const { propertyId, setPropertyId } = useProperty();
  return (
    <>
      <output>{propertyId}</output>
      <button type="button" onClick={() => setPropertyId('property-2')}>Switch</button>
    </>
  );
}

describe('PropertyProvider socket room lifecycle', () => {
  beforeEach(() => {
    socketState.connectListeners.clear();
    socketState.join.mockClear();
    socketState.leave.mockClear();
  });

  it('rejoins after reconnect and leaves the old room before joining a new property', async () => {
    render(
      <MemoryRouter initialEntries={['/?propertyId=property-1']}>
        <PropertyProvider><Probe /></PropertyProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(socketState.join).toHaveBeenCalledWith('property-1'));
    expect(socketState.connectListeners.size).toBe(1);

    for (const listener of socketState.connectListeners) listener();
    expect(socketState.join).toHaveBeenCalledTimes(2);
    expect(socketState.join).toHaveBeenLastCalledWith('property-1');

    await userEvent.click(screen.getByRole('button', { name: 'Switch' }));
    await waitFor(() => expect(socketState.join).toHaveBeenLastCalledWith('property-2'));
    expect(socketState.leave).toHaveBeenCalledWith('property-1');
    expect(socketState.leave.mock.invocationCallOrder.at(-1)).toBeLessThan(
      socketState.join.mock.invocationCallOrder.at(-1)!,
    );
    expect(socketState.connectListeners.size).toBe(1);

    const propertyOneJoinCount = socketState.join.mock.calls
      .filter(([propertyId]) => propertyId === 'property-1').length;
    for (const listener of socketState.connectListeners) listener();
    expect(socketState.join).toHaveBeenLastCalledWith('property-2');
    expect(socketState.join.mock.calls.filter(([propertyId]) => propertyId === 'property-1'))
      .toHaveLength(propertyOneJoinCount);
  });
});
