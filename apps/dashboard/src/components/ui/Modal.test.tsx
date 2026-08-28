import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Test">Content</Modal>);
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('renders title and children when open', () => {
    render(<Modal open={true} onClose={() => {}} title="My Modal">Modal body</Modal>);
    expect(screen.getByText('My Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal body')).toBeInTheDocument();
  });

  it('calls onClose when X button clicked', async () => {
    const onClose = vi.fn();
    render(<Modal open={true} onClose={onClose} title="Test">Body</Modal>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop clicked', async () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Test">Body</Modal>,
    );
    await userEvent.click(screen.getByLabelText('Close Test'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies wide class when wide prop is true', () => {
    render(<Modal open={true} onClose={() => {}} title="Wide" wide>Content</Modal>);
    const modal = screen.getByText('Content').closest('.relative');
    expect(modal?.className).toContain('max-w-2xl');
  });
});
