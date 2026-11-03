import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu, QuickActionButton, type ActionMenuItem } from './ContextMenu';

describe('ContextMenu', () => {
  it('does not render when position is null', () => {
    const items: ActionMenuItem[] = [{ label: 'Item 1' }];
    render(<ContextMenu items={items} position={null} onClose={() => {}} />);
    expect(screen.queryByText('Item 1')).not.toBeInTheDocument();
  });

  it('renders menu items and triggers onClick', async () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: ActionMenuItem[] = [
      { label: 'Item 1', onClick },
      { label: 'Item 2', disabled: true },
    ];

    render(<ContextMenu items={items} position={{ x: 100, y: 100 }} onClose={onClose} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Item 1'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not trigger onClick for disabled item', async () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: ActionMenuItem[] = [{ label: 'Disabled Item', disabled: true, onClick }];

    render(<ContextMenu items={items} position={{ x: 100, y: 100 }} onClose={onClose} />);
    await userEvent.click(screen.getByText('Disabled Item'));
    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders quick action button and toggles menu', async () => {
    const items: ActionMenuItem[] = [{ label: 'Action A' }];
    render(<QuickActionButton items={items} label="Actions" />);

    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.queryByText('Action A')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Actions'));
    expect(screen.getByText('Action A')).toBeInTheDocument();
  });

  it('renders nested submenu items on hover', async () => {
    const onChildClick = vi.fn();
    const items: ActionMenuItem[] = [
      {
        id: 'parent',
        label: 'Parent Menu',
        children: [
          { id: 'child-1', label: 'Child Item 1', onClick: onChildClick },
          { id: 'child-2', label: 'Child Item 2' },
        ],
      },
    ];

    render(<ContextMenu items={items} position={{ x: 100, y: 100 }} onClose={() => {}} />);
    expect(screen.getByText('Parent Menu')).toBeInTheDocument();
    expect(screen.queryByText('Child Item 1')).not.toBeInTheDocument();

    await userEvent.hover(screen.getByText('Parent Menu'));
    expect(await screen.findByText('Child Item 1')).toBeInTheDocument();
    expect(screen.getByText('Child Item 2')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Child Item 1'));
    expect(onChildClick).toHaveBeenCalledOnce();
  });
});
