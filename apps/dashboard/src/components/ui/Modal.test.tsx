import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

describe('Modal', () => {
  const showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function closeDialog(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });

  beforeEach(() => {
    showModal.mockClear();
    close.mockClear();
    window.HTMLDialogElement.prototype.showModal = showModal;
    window.HTMLDialogElement.prototype.close = close;
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Test">Content</Modal>);
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('opens the native modal dialog with its title and children', () => {
    render(<Modal open onClose={() => {}} title="My Modal">Modal body</Modal>);
    expect(screen.getByText('My Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal body')).toBeInTheDocument();
    expect(showModal).toHaveBeenCalledOnce();
  });

  it('calls onClose when the localized close button is clicked', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Test">Body</Modal>);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop clicked', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Test">Body</Modal>);
    const backdrop = document.body.querySelector('[data-modal-backdrop]');
    if (backdrop) await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the native dialog backdrop targets the dialog itself', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Test">Body</Modal>);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies wide class when wide prop is true', () => {
    render(<Modal open onClose={() => {}} title="Wide" wide>Content</Modal>);
    const modal = screen.getByRole('dialog');
    expect(modal.className).toContain('max-w-2xl');
  });

  it('makes background content inert and prevents focus or activation', async () => {
    const activated = vi.fn();
    const { container } = render(
      <>
        <button type="button" onClick={activated}>Background action</button>
        <Modal open onClose={() => {}} title="Blocking modal">Body</Modal>
      </>,
    );
    const background = screen.getByRole('button', { name: 'Background action', hidden: true });

    expect(container).toHaveAttribute('inert');
    background.focus();
    expect(background).not.toHaveFocus();
    await userEvent.click(background);
    expect(activated).not.toHaveBeenCalled();
  });
});
