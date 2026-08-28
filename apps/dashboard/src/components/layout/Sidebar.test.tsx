import { beforeEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/helpers';
import Sidebar from './Sidebar';

const auth = vi.hoisted(() => ({
  permissions: new Set<string>(['reservations.read']),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    hasRole: () => true,
    hasPermission: (permission: string) => auth.permissions.has(permission),
  }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    auth.permissions = new Set([
      'dashboard.view',
      'frontdesk.access',
      'reservations.read',
      'guests.read',
      'rooms.read',
      'housekeeping.read',
      'folios.read',
      'groups.read',
      'commercial.read',
      'cashier.access',
      'houseaccounts.read',
      'accounting.view',
      'tax.manage',
      'rateplans.read',
      'revenue.manage',
      'nightaudit.run',
      'reports.view',
      'channels.manage',
      'settings.manage',
      'communications.manage',
      'reviews.manage',
      'admin.users.manage',
    ]);
  });

  it('renders all navigation items', () => {
    renderWithProviders(<Sidebar mobileOpen={false} onClose={() => {}} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Front Desk')).toBeInTheDocument();
    expect(screen.getByText('Reservations')).toBeInTheDocument();
    expect(screen.getByText('Booking Requests')).toBeInTheDocument();
    expect(screen.getByText('Guests')).toBeInTheDocument();
    expect(screen.getByText('Rooms')).toBeInTheDocument();
    expect(screen.getByText('Housekeeping')).toBeInTheDocument();
    expect(screen.getByText('Folios & Billing')).toBeInTheDocument();
    expect(screen.getByText('Rate Plans')).toBeInTheDocument();
    expect(screen.getByText('Night Audit')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows booking requests only with reservations.read', () => {
    auth.permissions.delete('reservations.read');
    renderWithProviders(<Sidebar mobileOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('Booking Requests')).not.toBeInTheDocument();

    auth.permissions.add('reservations.read');
    renderWithProviders(<Sidebar mobileOpen={false} onClose={() => {}} />);
    expect(screen.getByRole('link', { name: 'Booking Requests' })).toHaveAttribute(
      'href',
      '/booking-requests',
    );
  });

  it('shows HAIP branding', () => {
    renderWithProviders(<Sidebar mobileOpen={false} onClose={() => {}} />);
    expect(screen.getByText('HAIP')).toBeInTheDocument();
    expect(screen.getByText('Hotel AI Platform')).toBeInTheDocument();
  });

  it('has hidden sidebar by default on mobile (translate-x-full)', () => {
    renderWithProviders(<Sidebar mobileOpen={false} onClose={() => {}} />);
    const aside = screen.getByRole('navigation', { name: /main/i }).closest('aside');
    expect(aside?.className).toContain('-translate-x-full');
  });

  it('shows sidebar when mobileOpen is true', () => {
    renderWithProviders(<Sidebar mobileOpen={true} onClose={() => {}} />);
    const aside = screen.getByRole('navigation', { name: /main/i }).closest('aside');
    expect(aside?.className).toContain('translate-x-0');
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderWithProviders(<Sidebar mobileOpen={true} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close menu'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when a nav link is clicked', async () => {
    const onClose = vi.fn();
    renderWithProviders(<Sidebar mobileOpen={true} onClose={onClose} />);
    await userEvent.click(screen.getByText('Rooms'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders overlay when mobileOpen', () => {
    const { container } = renderWithProviders(
      <Sidebar mobileOpen={true} onClose={() => {}} />,
    );
    const overlay = container.querySelector('.fixed.inset-0.bg-black\\/40');
    expect(overlay).toBeInTheDocument();
  });

  it('does not render overlay when closed', () => {
    const { container } = renderWithProviders(
      <Sidebar mobileOpen={false} onClose={() => {}} />,
    );
    const overlay = container.querySelector('.fixed.inset-0.bg-black\\/40');
    expect(overlay).not.toBeInTheDocument();
  });
});
