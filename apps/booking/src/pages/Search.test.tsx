import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BookingFlowProvider } from '../context/BookingFlowContext';
import { Search } from './Search';

function renderSearch() {
  return render(
    <MemoryRouter>
      <BookingFlowProvider>
        <Search />
      </BookingFlowProvider>
    </MemoryRouter>,
  );
}

describe('Search page', () => {
  it('renders the search form with date and occupancy fields', () => {
    renderSearch();
    expect(screen.getByText('Find a room')).toBeInTheDocument();
    expect(screen.getByLabelText(/Check-in/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Check-out/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Adults/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search availability/i })).toBeInTheDocument();
  });
});
