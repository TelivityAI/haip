import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/Toast';
import Integrations from './Integrations';

vi.mock('../context/PropertyContext', () => ({ useProperty: () => ({ propertyId: 'prop-1' }) }));
vi.mock('../lib/api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
import { api } from '../lib/api';

const config = { merchantCode: '999008881', terminal: '001', environment: 'test', secretKeyMasked: '••••••••' };
function renderIntegrations() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><Integrations /></ToastProvider></QueryClientProvider>);
}

describe('Redsys integration settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: [{ slug: 'redsys', name: 'Redsys', category: 'Payments', status: 'shipped', description: 'TPV', enabled: true, connectionId: 'conn-1', config }] });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('keeps a saved credential blank and omits it when saving other settings', async () => {
    renderIntegrations();
    expect(await screen.findByLabelText('Secret key')).toHaveValue('');
    expect(screen.getByText('Leave blank to keep the existing secret.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Environment'), 'live');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/v1/admin/integrations/redsys', {
      enabled: true, config: { merchantCode: '999008881', terminal: '001', environment: 'live' },
    }, { params: { propertyId: 'prop-1' } }));
  });

  it('submits a replacement secret then clears the input', async () => {
    renderIntegrations();
    await userEvent.type(await screen.findByLabelText('Secret key'), 'replacement-test-key');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/v1/admin/integrations/redsys', {
      enabled: true, config: { merchantCode: '999008881', terminal: '001', environment: 'test', secretKey: 'replacement-test-key' },
    }, { params: { propertyId: 'prop-1' } }));
    await waitFor(() => expect(screen.getByLabelText('Secret key')).toHaveValue(''));
  });

  it('toggles enablement using the masked config and the selected property', async () => {
    renderIntegrations();
    await userEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/v1/admin/integrations/redsys', { enabled: false, config }, { params: { propertyId: 'prop-1' } }));
  });
});
