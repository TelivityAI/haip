import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import BookingQuestionBuilder from './BookingQuestionBuilder';
import type { BookingFormQuestion } from './booking-request-config';
import BookingEngineSettings from './BookingEngineSettings';
import en from '../../locales/en.json';
import de from '../../locales/de.json';
import es from '../../locales/es.json';
import fr from '../../locales/fr.json';
import hr from '../../locales/hr.json';
import itMessages from '../../locales/it.json';
import ptBR from '../../locales/pt-BR.json';
import srLatn from '../../locales/sr-Latn.json';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../media/MediaGallery', () => ({ default: () => null }));

import { api } from '../../lib/api';

const FIRST_ID = '10000000-0000-4000-8000-000000000001';
const SECOND_ID = '10000000-0000-4000-8000-000000000002';
const THIRD_ID = '10000000-0000-4000-8000-000000000003';

const arrivalQuestion: BookingFormQuestion = {
  id: FIRST_ID,
  label: 'Arrival time',
  type: 'short_text',
  order: 4,
  isActive: true,
  isRequired: true,
};

const breakfastQuestion: BookingFormQuestion = {
  id: SECOND_ID,
  label: 'Breakfast preference',
  type: 'single_select',
  options: ['Continental', 'Cooked'],
  order: 9,
  isActive: false,
  isRequired: false,
};

function BuilderHarness({
  initial = [],
  idFactory,
  onValue,
}: {
  initial?: BookingFormQuestion[];
  idFactory?: () => string;
  onValue?: (value: BookingFormQuestion[]) => void;
}) {
  const [questions, setQuestions] = useState(initial);
  return (
    <BookingQuestionBuilder
      questions={questions}
      idFactory={idFactory}
      onChange={(next) => {
        setQuestions(next);
        onValue?.(next);
      }}
    />
  );
}

describe('BookingQuestionBuilder', () => {
  it('explains why a blank question cannot be saved', async () => {
    render(<BuilderHarness idFactory={() => FIRST_ID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));

    expect(screen.getByRole('textbox', { name: 'Question label' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a question label.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save question' })).toBeDisabled();
  });

  it('adds one exact Task 3 question with a stable, collision-free UUID', async () => {
    const changes: BookingFormQuestion[][] = [];
    const idFactory = vi.fn()
      .mockReturnValueOnce(FIRST_ID)
      .mockReturnValueOnce(THIRD_ID);
    render(
      <BuilderHarness
        initial={[arrivalQuestion]}
        idFactory={idFactory}
        onValue={(questions) => changes.push(questions)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), '  Travel purpose  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(changes.at(-1)).toEqual([
      arrivalQuestion,
      {
        id: THIRD_ID,
        label: 'Travel purpose',
        type: 'short_text',
        order: 5,
        isActive: true,
        isRequired: false,
      },
    ]);
    expect(idFactory).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'Edit Travel purpose' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Question label' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Reason for stay');
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(changes.at(-1)?.[1]).toMatchObject({
      id: THIRD_ID,
      label: 'Reason for stay',
      order: 5,
    });
    expect(idFactory).toHaveBeenCalledTimes(2);
  });

  it('edits and orders select options, normalizes whitespace, and rejects blank or duplicate options', async () => {
    const changes: BookingFormQuestion[][] = [];
    render(
      <BuilderHarness
        initial={[arrivalQuestion]}
        onValue={(questions) => changes.push(questions)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit Arrival time' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Question type' }), 'multi_select');
    const firstOption = screen.getByRole('textbox', { name: 'Option 1' });
    await userEvent.type(firstOption, '  Vegan  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add option' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Option 2' }), 'vegan');

    expect(screen.getByText('Options must be unique.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save question' })).toBeDisabled();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Option 2' }));
    expect(screen.getByText('Options cannot be blank.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Option 2' }), 'Gluten-free');
    await userEvent.click(screen.getByRole('button', { name: 'Move option 2 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(changes.at(-1)?.[0]).toEqual({
      ...arrivalQuestion,
      type: 'multi_select',
      options: ['Gluten-free', 'Vegan'],
    });
  });

  it('removes select options when the type changes to a non-select type', async () => {
    const changes: BookingFormQuestion[][] = [];
    render(
      <BuilderHarness
        initial={[breakfastQuestion]}
        onValue={(questions) => changes.push(questions)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit Breakfast preference' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Question type' }), 'date');

    expect(screen.queryByRole('textbox', { name: 'Option 1' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));
    expect(changes.at(-1)?.[0]).toEqual({
      id: SECOND_ID,
      label: 'Breakfast preference',
      type: 'date',
      order: 9,
      isActive: false,
      isRequired: false,
    });
  });

  it('reorders without changing identity and disables without dropping historical definitions', async () => {
    const changes: BookingFormQuestion[][] = [];
    render(
      <BuilderHarness
        initial={[arrivalQuestion, breakfastQuestion]}
        onValue={(questions) => changes.push(questions)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Move Breakfast preference up' }));
    expect(changes.at(-1)).toEqual([
      { ...arrivalQuestion, order: 1 },
      { ...breakfastQuestion, order: 0 },
    ]);

    await userEvent.click(screen.getByRole('switch', { name: 'Disable Arrival time' }));
    expect(changes.at(-1)).toEqual([
      { ...arrivalQuestion, order: 1, isActive: false },
      { ...breakfastQuestion, order: 0 },
    ]);
    expect(screen.getAllByText('Inactive')).toHaveLength(2);
  });

  it('removes a question without renumbering the survivors', async () => {
    const changes: BookingFormQuestion[][] = [];
    render(
      <BuilderHarness
        initial={[arrivalQuestion, breakfastQuestion]}
        onValue={(questions) => changes.push(questions)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove Arrival time' }));
    expect(changes.at(-1)).toEqual([breakfastQuestion]);
  });

  it('offers exactly the six approved question types and blocks a 51st question', async () => {
    const questions = Array.from({ length: 50 }, (_, index): BookingFormQuestion => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      label: `Question ${index + 1}`,
      type: 'short_text',
      order: index,
      isActive: true,
      isRequired: false,
    }));
    const { rerender } = render(<BuilderHarness initial={[]} idFactory={() => THIRD_ID} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));

    const types = within(screen.getByRole('combobox', { name: 'Question type' }))
      .getAllByRole('option')
      .map((option) => ({ label: option.textContent, value: (option as HTMLOptionElement).value }));
    expect(types).toEqual([
      { label: 'Short text', value: 'short_text' },
      { label: 'Long text', value: 'long_text' },
      { label: 'Single select', value: 'single_select' },
      { label: 'Multiple select', value: 'multi_select' },
      { label: 'Yes / no', value: 'yes_no' },
      { label: 'Date', value: 'date' },
    ]);

    rerender(<BuilderHarness key="full" initial={questions} />);
    expect(screen.getByRole('button', { name: 'Add question' })).toBeDisabled();
    expect(screen.getByText('50 of 50 questions')).toBeInTheDocument();
  });
});

const baseConfig = {
  id: 'config-1',
  propertyId: 'property-1',
  isEnabled: true,
  displayName: 'Harbour Hotel',
  logoMediaId: null,
  primaryColor: '#016491',
  accentColor: '#f2641b',
  sellableRoomTypeIds: ['room-type-1'],
  sellableRatePlanIds: ['rate-plan-1'],
  depositPolicy: { type: 'none' as const, refundable: true },
  autoConfirm: false,
  stripePublishableKey: 'pk_test_property',
  bookingMode: 'request' as const,
  paymentMethodCollection: 'optional' as const,
  formQuestions: [arrivalQuestion, breakfastQuestion],
};

function mockQueries(config: Record<string, unknown> = baseConfig) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/v1/admin/booking-engine/config') {
      return Promise.resolve({ data: { data: config } } as never);
    }
    return Promise.resolve({ data: { data: [] } } as never);
  });
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BookingEngineSettings propertyId="property-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('BookingEngineSettings request configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries();
    vi.mocked(api.patch).mockResolvedValue({ data: { data: baseConfig } } as never);
  });

  it('uses safe request defaults when older config responses omit the new fields', async () => {
    const legacyConfig: Record<string, unknown> = { ...baseConfig };
    delete legacyConfig.bookingMode;
    delete legacyConfig.paymentMethodCollection;
    delete legacyConfig.formQuestions;
    mockQueries(legacyConfig);
    renderSettings();

    expect(await screen.findByRole('combobox', { name: 'Booking mode' })).toHaveValue('instant');
    expect(screen.getByRole('combobox', { name: 'Card collection' })).toHaveValue('disabled');
    expect(screen.getByText('0 of 50 questions')).toBeInTheDocument();
  });

  it('warns and prevents saving required card collection without a Stripe publishable key', async () => {
    mockQueries({
      ...baseConfig,
      stripePublishableKey: null,
      paymentMethodCollection: 'required',
    });
    renderSettings();

    const name = await screen.findByRole('textbox', { name: 'Display Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Hotel without Stripe');

    expect(screen.getByRole('alert')).toHaveTextContent('Add a Stripe publishable key before requiring card collection.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('resets dirty request changes and saves the exact Task 3 payload shape', async () => {
    renderSettings();
    const mode = await screen.findByRole('combobox', { name: 'Booking mode' });
    const cardPolicy = screen.getByRole('combobox', { name: 'Card collection' });

    await userEvent.selectOptions(mode, 'instant');
    await userEvent.selectOptions(cardPolicy, 'disabled');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(mode).toHaveValue('request');
    expect(cardPolicy).toHaveValue('optional');

    await userEvent.selectOptions(cardPolicy, 'required');
    await userEvent.click(screen.getByRole('switch', { name: 'Disable Arrival time' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0]).toEqual([
      '/v1/admin/booking-engine/config',
      {
        isEnabled: true,
        displayName: 'Harbour Hotel',
        logoMediaId: null,
        primaryColor: '#016491',
        accentColor: '#f2641b',
        sellableRoomTypeIds: ['room-type-1'],
        sellableRatePlanIds: ['rate-plan-1'],
        depositPolicy: { type: 'none', refundable: true },
        autoConfirm: false,
        stripePublishableKey: 'pk_test_property',
        bookingMode: 'request',
        paymentMethodCollection: 'required',
        formQuestions: [
          { ...arrivalQuestion, isActive: false },
          breakfastQuestion,
        ],
      },
      { params: { propertyId: 'property-1' } },
    ]);
  });

  it('retains disabled historical definitions when another setting is saved', async () => {
    renderSettings();
    await screen.findByRole('combobox', { name: 'Booking mode' });
    await userEvent.click(screen.getByRole('switch', { name: 'Disable Arrival time' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Enable Arrival time' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Booking mode' }), 'instant');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0]?.[1]).toMatchObject({
      formQuestions: [arrivalQuestion, breakfastQuestion],
    });
  });

  it('shows loading, load failure with retry, and save failure states', async () => {
    let rejectConfig: ((reason?: unknown) => void) | undefined;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/v1/admin/booking-engine/config') {
        return new Promise((_resolve, reject) => { rejectConfig = reject; }) as never;
      }
      return Promise.resolve({ data: { data: [] } } as never);
    });
    const firstRender = renderSettings();
    expect(screen.getByRole('status')).toHaveTextContent('Loading booking engine settings');
    await act(async () => { rejectConfig?.(new Error('offline')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load booking engine settings.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    firstRender.unmount();

    mockQueries();
    vi.mocked(api.patch).mockRejectedValue(new Error('save failed'));
    renderSettings();
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Booking mode' }),
      'instant',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Could not save booking engine settings.')).toBeInTheDocument();
  });

  it('allows only one save mutation at a time', async () => {
    let resolveSave: ((value: unknown) => void) | undefined;
    vi.mocked(api.patch).mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }) as never);
    renderSettings();
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Booking mode' }),
      'instant',
    );
    const save = screen.getByRole('button', { name: 'Save changes' });
    await userEvent.click(save);

    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(api.patch).toHaveBeenCalledOnce();
    await act(async () => {
      resolveSave?.({ data: { data: { ...baseConfig, bookingMode: 'instant' } } });
    });
  });
});

describe('booking request settings translations', () => {
  it('defines every visible booking-engine string in every supported locale', () => {
    const locales = { en, de, es, fr, hr, it: itMessages, 'pt-BR': ptBR, 'sr-Latn': srLatn };
    const leafPaths = (value: unknown, prefix = ''): string[] => Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => child && typeof child === 'object'
        ? leafPaths(child, prefix ? `${prefix}.${key}` : key)
        : [prefix ? `${prefix}.${key}` : key]);
    const sourcePaths = leafPaths(en.bookingEngine).sort();
    for (const [locale, messages] of Object.entries(locales)) {
      const bookingEngine = (messages as { bookingEngine?: unknown }).bookingEngine;
      expect(bookingEngine, `${locale} bookingEngine`).toBeTypeOf('object');
      expect(leafPaths(bookingEngine).sort(), `${locale} bookingEngine keys`).toEqual(sourcePaths);
      expect(JSON.stringify(bookingEngine), `${locale} bookingEngine`).not.toContain('""');
    }
  });
});
