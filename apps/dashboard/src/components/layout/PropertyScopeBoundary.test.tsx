import { useEffect, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PropertyScopeBoundary, { supportsPortfolio } from './PropertyScopeBoundary';
import App from '../../App';

const mocks = vi.hoisted(() => ({ id: 'portfolio', loading: false, error: null as string | null, set: vi.fn(), mounted: vi.fn() }));
vi.mock('../../context/PropertyContext', () => ({ useProperty: () => ({
  propertyId: mocks.id, isPortfolioMode: mocks.id === 'portfolio', propertiesLoading: mocks.loading,
  propertiesError: mocks.error, properties: [{ id: 'property-a', name: 'First property' }], setPropertyId: mocks.set,
}) }));
vi.mock('./AppLayout', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../../hooks/useRealtimeInvalidation', () => ({ useRealtimeInvalidation: vi.fn() }));
function Page() { useEffect(() => { mocks.mounted(); }, []); return <p>Operational page</p>; }
function view(path: string) { return render(<MemoryRouter initialEntries={[path]}><PropertyScopeBoundary><Page /></PropertyScopeBoundary></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); mocks.id = 'portfolio'; mocks.loading = false; mocks.error = null; });

describe('staff portfolio boundary', () => {
  it.each(['/integrations', '/rooms', '/reservations', '/groups', '/settings?tab=users', '/channels/connection-a', '/channels/rate-parity', '/channels/ical'])('does not mount property-scoped pages at %s', path => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Choose a property' })).toBeInTheDocument();
  });
  it('requires an explicit property choice before mounting operational effects', async () => {
    const rendered = view('/integrations');
    expect(mocks.mounted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'First property' }));
    expect(mocks.set).toHaveBeenCalledWith('property-a');
    mocks.id = 'property-a';
    rendered.rerender(<MemoryRouter initialEntries={['/integrations']}><PropertyScopeBoundary><Page /></PropertyScopeBoundary></MemoryRouter>);
    expect(mocks.mounted).toHaveBeenCalledOnce();
  });
  it.each(['/', '/reports', '/reports/occupancy', '/channels'])('keeps the existing portfolio view at %s', path => {
    view(path); expect(screen.getByText('Operational page')).toBeInTheDocument();
    expect(supportsPortfolio(path)).toBe(true);
  });
  it('shows loading and a safe bootstrap failure without mounting the page', () => {
    mocks.loading = true;
    const rendered = view('/integrations');
    expect(screen.getByRole('status')).toHaveTextContent('Loading properties');
    mocks.loading = false; mocks.error = 'private transport detail';
    rendered.rerender(<MemoryRouter><PropertyScopeBoundary><Page /></PropertyScopeBoundary></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Properties could not load');
    expect(screen.queryByText('private transport detail')).not.toBeInTheDocument();
    expect(mocks.mounted).not.toHaveBeenCalled();
  });
});
