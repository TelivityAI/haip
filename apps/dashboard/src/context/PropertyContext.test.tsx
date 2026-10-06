import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { PropertyProvider, useProperty, PORTFOLIO_MODE_ID } from './PropertyContext';

const mocks = vi.hoisted(() => ({ get: vi.fn(), setApiPropertyId: vi.fn(), join: vi.fn(), leave: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { get: mocks.get }, setPropertyId: mocks.setApiPropertyId }));
vi.mock('../lib/socket', () => ({ joinPropertyRoom: mocks.join, leavePropertyRoom: mocks.leave }));
const properties = [{ id: 'property-a', name: 'First property', currencyCode: 'EUR' }, { id: 'property-b', name: 'Second property', currencyCode: 'USD' }];

function Harness() {
  const context = useProperty();
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="scope">{context.propertyId ?? 'none'}</output>
    <output data-testid="url">{location.pathname}{location.search}</output>
    <output data-testid="currency">{context.currencyCode ?? 'none'}</output>
    <button onClick={() => navigate('/rooms?tab=status')}>Rooms</button>
    <button onClick={() => navigate('/reservations?propertyId=property-b')}>Linked second property</button>
    <button onClick={() => context.setPropertyId('property-b')}>Select second property</button>
    <button onClick={() => context.setPropertyId(PORTFOLIO_MODE_ID)}>Select portfolio</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
  </>;
}
function setup(route: string) {
  return render(<MemoryRouter initialEntries={[route]}><PropertyProvider><Harness /></PropertyProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation((path: string) => Promise.resolve({ data: path === '/v1/properties' ? properties : [] }));
});
describe('PropertyProvider navigation scope', () => {
  it('retains a selected property across bare navigation and a fresh provider mount', async () => {
    const first = setup('/reservations?propertyId=property-a');
    await screen.findByText('EUR');
    await userEvent.click(screen.getByRole('button', { name: 'Rooms' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/rooms?tab=status&propertyId=property-a'));
    const reloadUrl = screen.getByTestId('url').textContent!;
    expect(screen.getByTestId('scope')).toHaveTextContent('property-a');
    first.unmount();
    setup(reloadUrl);
    await screen.findByText('EUR');
    expect(screen.getByTestId('scope')).toHaveTextContent('property-a');
  });
  it('honours a property deep link and browser history instead of stale React state', async () => {
    setup('/reservations?propertyId=property-a');
    await screen.findByText('EUR');
    await userEvent.click(screen.getByRole('button', { name: 'Linked second property' }));
    await waitFor(() => expect(screen.getByTestId('scope')).toHaveTextContent('property-b'));
    expect(screen.getByTestId('currency')).toHaveTextContent('USD');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByTestId('scope')).toHaveTextContent('property-a'));
    await userEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await waitFor(() => expect(screen.getByTestId('scope')).toHaveTextContent('property-b'));
    expect(mocks.leave).toHaveBeenCalledWith('property-a');
    expect(mocks.join).toHaveBeenCalledWith('property-b');
  });
  it('keeps portfolio mode during navigation and removes the API property default', async () => {
    setup('/reports?propertyId=portfolio');
    await userEvent.click(screen.getByRole('button', { name: 'Rooms' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('propertyId=portfolio'));
    expect(screen.getByTestId('scope')).toHaveTextContent(PORTFOLIO_MODE_ID);
    expect(mocks.setApiPropertyId).toHaveBeenLastCalledWith(null);
  });
  it('does not overwrite a user selection when property bootstrap finishes later', async () => {
    let resolveProperties!: (value: { data: typeof properties }) => void;
    mocks.get.mockImplementation((path: string) => path === '/v1/properties' ? new Promise(resolve => { resolveProperties = resolve; }) : Promise.resolve({ data: [] }));
    setup('/');
    await userEvent.click(screen.getByRole('button', { name: 'Select second property' }));
    resolveProperties({ data: properties });
    await screen.findByText('USD');
    expect(screen.getByTestId('scope')).toHaveTextContent('property-b');
  });
  it('defaults an unscoped initial visit to portfolio without adding an extra history entry', async () => {
    setup('/reports?tab=revenue');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/reports?tab=revenue&propertyId=portfolio'));
    expect(screen.getByTestId('scope')).toHaveTextContent('portfolio');
  });
});
