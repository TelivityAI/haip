import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IcalCalendars from './IcalCalendars';
import type { IcalFeed, IcalFeedInput } from '../lib/ical';

const mocks = vi.hoisted(() => ({
  propertyId: 'property-a', portfolio: false, roles: ['admin'],
  feeds: vi.fn(), roomTypes: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), sync: vi.fn(), rotate: vi.fn(), blocks: vi.fn(),
}));
vi.mock('../context/PropertyContext', () => ({ useProperty: () => ({ propertyId: mocks.propertyId, isPortfolioMode: mocks.portfolio, properties: [{ id: 'property-a', name: 'First property' }, { id: 'property-b', name: 'Second property' }] }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ hasRole: (...roles: string[]) => roles.some(role => mocks.roles.includes(role)) }) }));
vi.mock('../lib/ical', async importOriginal => ({ ...await importOriginal<typeof import('../lib/ical')>(), icalApi: mocks }));
const importFeed: IcalFeed = { id: 'import-a', propertyId: 'property-a', roomTypeId: 'room-a', name: 'External calendar', direction: 'import', sourceUrl: 'https://calendar.example.test/a.ics', isActive: true, lastSyncAt: null, lastSyncStatus: null };
let feeds: IcalFeed[];
function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><IcalCalendars /></QueryClientProvider></MemoryRouter>);
}
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.propertyId = 'property-a'; mocks.portfolio = false; mocks.roles = ['admin']; feeds = [{ ...importFeed }];
  mocks.feeds.mockImplementation((propertyId: string) => Promise.resolve(feeds.filter(feed => feed.propertyId === propertyId)));
  mocks.roomTypes.mockImplementation((propertyId: string) => Promise.resolve([{ id: propertyId === 'property-a' ? 'room-a' : 'room-b', name: 'Standard room', propertyId }]));
  mocks.create.mockImplementation((input: IcalFeedInput) => { const feed: IcalFeed = { ...input, id: 'new-feed', sourceUrl: input.sourceUrl ?? null, isActive: true, lastSyncAt: null, lastSyncStatus: null }; feeds.push(feed); return Promise.resolve({ feed, ...(input.direction === 'export' ? { exportUrl: 'https://pms.example.test/api/v1/ical/export.ics?token=first' } : {}) }); });
  mocks.update.mockImplementation((propertyId: string, id: string, patch: Partial<IcalFeed>) => { const feed = feeds.find(entry => entry.propertyId === propertyId && entry.id === id)!; Object.assign(feed, patch); return Promise.resolve(feed); });
  mocks.remove.mockImplementation((_propertyId: string, id: string) => { feeds = feeds.filter(feed => feed.id !== id); return Promise.resolve(); });
  mocks.sync.mockResolvedValue(undefined);
  mocks.rotate.mockImplementation(() => Promise.resolve({ feed: feeds.find(feed => feed.direction === 'export'), exportUrl: 'https://pms.example.test/api/v1/ical/export.ics?token=second' }));
  mocks.blocks.mockResolvedValue([{ externalUid: 'event-1', startDate: '2027-01-01', endDate: '2027-01-04' }]);
});
describe('iCal calendars', () => {
  it('creates an import using the selected property and room type', async () => {
    view(); await screen.findByText('External calendar');
    await userEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
    await userEvent.type(screen.getByLabelText('Calendar name'), 'Channel calendar');
    await userEvent.selectOptions(screen.getByLabelText('Room type'), 'room-a');
    await userEvent.type(screen.getByLabelText('Import calendar URL'), 'https://calendar.example.test/new.ics');
    await userEvent.click(screen.getByRole('button', { name: 'Save calendar' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ propertyId: 'property-a', roomTypeId: 'room-a', direction: 'import', name: 'Channel calendar', sourceUrl: 'https://calendar.example.test/new.ics' }));
    expect(await screen.findByText('Calendar saved.')).toBeInTheDocument();
  });
  it('replays manual sync and reads blocked dates with explicit property scope', async () => {
    view(); await screen.findByText('External calendar');
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith('property-a', 'import-a'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View blocked dates' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'View blocked dates' }));
    expect(await screen.findByText(/2027-01-01 → 2027-01-04/)).toBeInTheDocument();
    expect(mocks.blocks).toHaveBeenCalledWith('property-a', 'import-a');
  });
  it('handles sync errors without displaying private provider messages', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('private-provider-token=secret'));
    view(); await screen.findByText('External calendar');
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The calendar request could not complete');
    expect(screen.queryByText(/private-provider-token/)).not.toBeInTheDocument();
    expect(screen.getByText('External calendar')).toBeInTheDocument();
  });
  it('edits the import URL and deactivates a feed without changing its mapping', async () => {
    view(); await screen.findByText('External calendar');
    await userEvent.click(screen.getByRole('button', { name: 'Edit calendar' }));
    expect(screen.getByLabelText('Property')).toBeDisabled(); expect(screen.getByLabelText('Room type')).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Import calendar URL'));
    await userEvent.type(screen.getByLabelText('Import calendar URL'), 'https://calendar.example.test/cancelled.ics');
    await userEvent.click(screen.getByRole('button', { name: 'Save calendar' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('property-a', 'import-a', { name: 'External calendar', sourceUrl: 'https://calendar.example.test/cancelled.ics' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled());
    expect(mocks.update).toHaveBeenCalledWith('property-a', 'import-a', { isActive: false });
  });
  it('requires confirmation for removal and supports cancelling it', async () => {
    view(); await screen.findByText('External calendar');
    await userEvent.click(screen.getByRole('button', { name: 'Remove calendar' }));
    expect(within(screen.getByRole('dialog')).getByText('External calendar')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('First property · Standard room · Import')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove calendar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove calendar' }));
    expect(await screen.findByText('Calendar removed.')).toBeInTheDocument();
    expect(mocks.remove).toHaveBeenCalledWith('property-a', 'import-a');
  });
  it('shows a newly issued export URL and explicitly confirms rotation', async () => {
    feeds = [];
    view(); await screen.findByText('No iCal calendars yet');
    await userEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
    await userEvent.type(screen.getByLabelText('Calendar name'), 'Direct calendar');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'export');
    await userEvent.selectOptions(screen.getByLabelText('Room type'), 'room-a');
    expect(screen.queryByLabelText('Import calendar URL')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save calendar' }));
    expect(await screen.findByLabelText('Export calendar URL')).toHaveValue('https://pms.example.test/api/v1/ical/export.ics?token=first');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate export URL' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate export URL' }));
    expect(within(screen.getByRole('dialog')).getByText('Direct calendar')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('First property · Standard room · Export')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText(/immediately invalidates/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate export URL' }));
    await waitFor(() => expect(screen.getByLabelText('Export calendar URL')).toHaveValue('https://pms.example.test/api/v1/ical/export.ics?token=second'));
    expect(mocks.rotate).toHaveBeenCalledWith('property-a', 'new-feed');
  });
  it('supports portfolio reads and property-specific creation without a portfolio API scope', async () => {
    mocks.propertyId = 'portfolio'; mocks.portfolio = true;
    view(); await screen.findByText('External calendar');
    expect(mocks.feeds).toHaveBeenCalledWith('property-a'); expect(mocks.feeds).toHaveBeenCalledWith('property-b');
    expect(mocks.feeds).not.toHaveBeenCalledWith('portfolio');
    await userEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
    await userEvent.type(screen.getByLabelText('Calendar name'), 'Second-property calendar');
    await userEvent.selectOptions(screen.getByLabelText('Property'), 'property-b');
    await userEvent.selectOptions(screen.getByLabelText('Room type'), 'room-b');
    await userEvent.type(screen.getByLabelText('Import calendar URL'), 'https://calendar.example.test/b.ics');
    await userEvent.click(screen.getByRole('button', { name: 'Save calendar' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'property-b', roomTypeId: 'room-b' })));
  });
  it('keeps revenue-manager sync available while hiding administrator writes', async () => {
    mocks.roles = ['revenue_manager']; view(); await screen.findByText('External calendar');
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Add calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove calendar' })).not.toBeInTheDocument();
  });
  it('does not fetch feeds for a staff role without calendar access', async () => {
    mocks.roles = ['housekeeper']; view();
    expect(screen.getByRole('alert')).toHaveTextContent('Calendar access requires'); expect(mocks.feeds).not.toHaveBeenCalled();
  });
  it('clears private export URLs and drafts when the active property changes', async () => {
    feeds = [];
    const rendered = view(); await screen.findByText('No iCal calendars yet');
    await userEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
    await userEvent.type(screen.getByLabelText('Calendar name'), 'Direct calendar');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'export');
    await userEvent.selectOptions(screen.getByLabelText('Room type'), 'room-a');
    await userEvent.click(screen.getByRole('button', { name: 'Save calendar' }));
    await screen.findByLabelText('Export calendar URL');
    mocks.propertyId = 'property-b';
    rendered.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><IcalCalendars /></QueryClientProvider></MemoryRouter>);
    await waitFor(() => expect(screen.queryByLabelText('Export calendar URL')).not.toBeInTheDocument());
  });
});
