import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Combobox from './Combobox';

describe('Combobox', () => {
  const options = [
    { value: 'BR', label: 'Brazil' },
    { value: 'US', label: 'United States' },
    { value: 'FR', label: 'France' },
  ];

  it('renders with initial value and static options', () => {
    render(<Combobox value="BR" onChange={vi.fn()} options={options} placeholder="Select country" />);
    const input = screen.getByPlaceholderText('Select country') as HTMLInputElement;
    expect(input.value).toBe('Brazil');
  });

  it('opens listbox on focus and filters options', async () => {
    render(<Combobox value="" onChange={vi.fn()} options={options} placeholder="Select country" />);
    const input = screen.getByPlaceholderText('Select country');
    fireEvent.focus(input);

    expect(screen.getByText('Brazil')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Fra' } });
    expect(screen.getByText('France')).toBeInTheDocument();
    expect(screen.queryByText('Brazil')).not.toBeInTheDocument();
  });

  it('selects an option on click', async () => {
    const handleChange = vi.fn();
    render(<Combobox value="" onChange={handleChange} options={options} placeholder="Select country" />);
    const input = screen.getByPlaceholderText('Select country');
    fireEvent.focus(input);

    const option = screen.getByText('Brazil');
    fireEvent.click(option);

    expect(handleChange).toHaveBeenCalledWith('BR', expect.objectContaining({ value: 'BR', label: 'Brazil' }));
  });

  it('allows custom input creation', async () => {
    const handleChange = vi.fn();
    render(<Combobox value="" onChange={handleChange} options={options} placeholder="Select country" allowCustom />);
    const input = screen.getByPlaceholderText('Select country');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Portugal' } });

    const createBtn = screen.getByText(/Portugal/);
    fireEvent.click(createBtn);

    expect(handleChange).toHaveBeenCalledWith('Portugal', expect.objectContaining({ value: 'Portugal', label: 'Portugal' }));
  });
});
