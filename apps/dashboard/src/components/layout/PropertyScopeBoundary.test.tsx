import { useEffect, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PropertyScopeBoundary, { supportsPortfolio } from './PropertyScopeBoundary';
import App from '../../App';
import type { PropertySummary } from '../../lib/property-types';

const mocks = vi.hoisted(() => ({ id: 'portfolio', loading: false, error: null as string | null, properties: [] as PropertySummary[], set: vi.fn(), mounted: vi.fn() }));
vi.mock('../../context/PropertyContext', () => ({ useProperty: () => ({
  propertyId: mocks.id, isPortfolioMode: mocks.id === 'portfolio', propertiesLoading: mocks.loading,
  propertiesError: mocks.error, properties: mocks.properties, setPropertyId: mocks.set,
}) }));
vi.mock('./AppLayout', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../../hooks/useRealtimeInvalidation', () => ({ useRealtimeInvalidation: vi.fn() }));
function Page() { useEffect(() => { mocks.mounted(); }, []); return <p>Operational page</p>; }
function view(path: string) { return render(<MemoryRouter initialEntries={[path]}><PropertyScopeBoundary><Page /></PropertyScopeBoundary></MemoryRouter>); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.id = 'portfolio'; mocks.loading = false; mocks.error = null;
  mocks.properties = [{ id: 'property-a', name: 'First property', code: 'FIRST' }];
});

describe('staff portfolio boundary', () => {
  it.each(['/integrations', '/rooms', '/reservations', '/groups', '/settings?tab=users', '/channels/connection-a', '/channels/rate-parity'])('does not mount property-scoped pages at %s', path => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Choose a property' })).toBeInTheDocument();
  });
  it('requires an explicit property choice before mounting operational effects', async () => {
    const rendered = view('/integrations');
    expect(mocks.mounted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'First property (FIRST)' }));
    expect(mocks.set).toHaveBeenCalledWith('property-a');
    mocks.id = 'property-a';
    rendered.rerender(<MemoryRouter initialEntries={['/integrations']}><PropertyScopeBoundary><Page /></PropertyScopeBoundary></MemoryRouter>);
    expect(mocks.mounted).toHaveBeenCalledOnce();
  });
  it.each(['/', '/reports', '/reports/occupancy', '/channels', '/channels/ical'])('keeps the existing portfolio view at %s', path => {
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
  it('bounds a large catalogue and resets the visible batch when searching', async () => {
    mocks.properties = Array.from({ length: 1000 }, (_, index) => ({ id: `property-${index}`, name: `Property ${index}`, code: `CODE-${index}` }));
    view('/rooms');
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'Show more properties' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search properties' }), 'CODE-999');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(mocks.mounted).not.toHaveBeenCalled();
  });
  it('matches names and codes without case or accent sensitivity and distinguishes duplicate names', async () => {
    mocks.properties = [
      { id: 'property-a', name: 'Café Apartments', code: 'NORTH' },
      { id: 'property-b', name: 'Café Apartments', code: 'SOUTH' },
    ];
    view('/integrations');
    const search = screen.getByRole('searchbox', { name: 'Search properties' });
    await userEvent.type(search, ' CAFE ');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.clear(search); await userEvent.type(search, 'south');
    await userEvent.click(screen.getByRole('button', { name: 'Café Apartments (SOUTH)' }));
    expect(mocks.set).toHaveBeenCalledWith('property-b');
  });
  it('recovers from no matches without changing the selected scope', async () => {
    view('/integrations');
    const search = screen.getByRole('searchbox', { name: 'Search properties' });
    await userEvent.type(search, 'unmatched property');
    expect(screen.getByText('No properties match your search.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[1]);
    expect(search).toHaveValue(''); expect(search).toHaveFocus();
    expect(screen.getByRole('button', { name: 'First property (FIRST)' })).toBeInTheDocument();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('shows an empty staff catalogue without a search or operational page', () => {
    mocks.properties = []; view('/rooms');
    expect(screen.getByText('No properties are available to your staff account.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(mocks.mounted).not.toHaveBeenCalled();
  });
});
