import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import BookingQuestionBuilder from './BookingQuestionBuilder';
import type {
  BookingFormQuestion,
  BookingFormQuestionDefinition,
} from './booking-request-config';
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
  initial?: BookingFormQuestionDefinition[];
  idFactory?: () => string;
  onValue?: (value: BookingFormQuestionDefinition[]) => void;
}) {
  const [questions, setQuestions] = useState<BookingFormQuestionDefinition[]>(initial);
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
    const changes: BookingFormQuestionDefinition[][] = [];
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
      { ...arrivalQuestion, order: 0 },
      {
        id: THIRD_ID,
        label: 'Travel purpose',
        type: 'short_text',
        order: 1,
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
      order: 1,
    });
    expect(idFactory).toHaveBeenCalledTimes(2);
  });

  it('edits and orders select options, normalizes whitespace, and rejects blank or duplicate options', async () => {
    const changes: BookingFormQuestionDefinition[][] = [];
    render(
      <BuilderHarness
        initial={[arrivalQuestion]}
        onValue={(questions) => changes.push(questions)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit Arrival time' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Question type' }), 'multi_select');
    const firstOption = screen.getByRole('textbox', { name: 'Option 1' });
    const optionsGroup = screen.getByRole('group', { name: 'Answer options' });
    expect(optionsGroup.firstElementChild?.tagName).toBe('LEGEND');
    await userEvent.type(firstOption, '  Vegan  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add option' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Option 2' }), 'vegan');

    expect(screen.getByText('Options must be unique.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Option 2' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Option 2' })).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('button', { name: 'Save question' })).toBeDisabled();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Option 2' }));
    expect(screen.getByText('Options cannot be blank.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Option 2' }), 'Gluten-free');
    await userEvent.click(screen.getByRole('button', { name: 'Move option 2 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(changes.at(-1)?.[0]).toEqual({
      ...arrivalQuestion,
      order: 0,
      type: 'multi_select',
      options: ['Gluten-free', 'Vegan'],
    });
  });

  it('removes select options when the type changes to a non-select type', async () => {
    const changes: BookingFormQuestionDefinition[][] = [];
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
      order: 0,
      isActive: false,
      isRequired: false,
    });
  });

  it('reorders without changing identity and disables without dropping historical definitions', async () => {
    const changes: BookingFormQuestionDefinition[][] = [];
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

  it('removes a question and normalizes survivor order', async () => {
    const changes: BookingFormQuestionDefinition[][] = [];
    render(
      <BuilderHarness
        initial={[arrivalQuestion, breakfastQuestion]}
        onValue={(questions) => changes.push(questions)}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove Arrival time' }));
    expect(changes.at(-1)).toEqual([{ ...breakfastQuestion, order: 0 }]);
  });

  it('locks list mutations while editing so saving cannot restore stale row state', async () => {
    const changes: BookingFormQuestionDefinition[][] = [];
    render(<BuilderHarness initial={[arrivalQuestion, breakfastQuestion]} onValue={(value) => changes.push(value)} />);

    await userEvent.click(screen.getByRole('button', { name: 'Edit Arrival time' }));
    expect(screen.getByRole('button', { name: 'Move Breakfast preference up' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Enable Breakfast preference' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Breakfast preference' })).toBeDisabled();

    await userEvent.clear(screen.getByRole('textbox', { name: 'Question label' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Arrival details');
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(changes.at(-1)).toEqual([
      { ...arrivalQuestion, label: 'Arrival details', order: 0 },
      { ...breakfastQuestion, order: 1 },
    ]);
  });

  it('focuses the editor and restores focus after cancel, save, and remove', async () => {
    render(<BuilderHarness initial={[arrivalQuestion, breakfastQuestion]} idFactory={() => THIRD_ID} />);
    const add = screen.getByRole('button', { name: 'Add question' });

    await userEvent.click(add);
    expect(screen.getByRole('textbox', { name: 'Question label' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(add).toHaveFocus());

    await userEvent.click(screen.getByRole('button', { name: 'Edit Arrival time' }));
    const label = screen.getByRole('textbox', { name: 'Question label' });
    expect(label).toHaveFocus();
    await userEvent.clear(label);
    await userEvent.type(label, 'Arrival details');
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Arrival details' })).toHaveFocus());

    await userEvent.click(screen.getByRole('button', { name: 'Remove Breakfast preference' }));
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('preserves an unsupported inactive definition opaquely and prevents destructive controls', async () => {
    const futureQuestion: BookingFormQuestionDefinition = {
      id: THIRD_ID,
      label: 'Legacy satisfaction score',
      type: 'rating_scale',
      order: 12,
      isActive: false,
      isRequired: false,
      options: ['1', '2', '3', '4', '5'],
      futureConfig: { maximum: 5, icon: 'star' },
    };
    const changes: BookingFormQuestionDefinition[][] = [];
    render(<BuilderHarness initial={[arrivalQuestion, futureQuestion]} onValue={(value) => changes.push(value)} />);

    expect(screen.getByText('Unsupported question')).toBeInTheDocument();
    expect(screen.queryByText('bookingEngine.questions.types.rating_scale')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Legacy satisfaction score' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Enable Legacy satisfaction score' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Legacy satisfaction score' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Arrival time' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Question label' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Arrival details');
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(changes.at(-1)?.[1]).toEqual({
      ...futureQuestion,
      order: 1,
    });
  });

  it('uses AA dashboard tokens for text, primary actions, and focus indicators', () => {
    const { container } = render(<BuilderHarness initial={[arrivalQuestion]} />);
    const section = container.querySelector('section[aria-labelledby="guest-form-blueprint-title"]');

    expect(section?.querySelectorAll('.text-telivity-mid-grey')).toHaveLength(0);
    expect(section?.querySelectorAll('.border-gray-300')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Add question' })).toHaveClass('bg-telivity-deep-blue');
    expect(screen.getByRole('button', { name: 'Add question' })).toHaveClass('focus-visible:ring-telivity-deep-blue');
  });

  it('restores focus to the newly added row when the fiftieth question disables Add', async () => {
    const questions = Array.from({ length: 49 }, (_, index): BookingFormQuestion => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      label: `Question ${index + 1}`,
      type: 'short_text',
      order: index,
      isActive: true,
      isRequired: false,
    }));
    render(<BuilderHarness
      initial={questions}
      idFactory={() => '10000000-0000-4000-8000-000000000999'}
    />);

    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Final question');
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(screen.getByRole('button', { name: 'Add question' })).toBeDisabled();
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Edit Final question' }),
    ).toHaveFocus());
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
    expect(screen.getByText('Questions: 50 / 50')).toBeInTheDocument();
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
  updatedAt: '2026-08-25T00:00:00.000Z',
};

function mockQueries(config: Record<string, unknown> = baseConfig) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/v1/admin/booking-engine/config') {
      return Promise.resolve({ data: { data: config } } as never);
    }
    return Promise.resolve({ data: { data: [] } } as never);
  });
}

function renderSettings(propertyId = 'property-1', providedClient?: QueryClient) {
  const queryClient = providedClient ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const settings = (nextPropertyId: string) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BookingEngineSettings propertyId={nextPropertyId} />
      </ToastProvider>
    </QueryClientProvider>
  );
  const view = render(settings(propertyId));
  return Object.assign(view, {
    queryClient,
    switchProperty: (nextPropertyId: string) => view.rerender(settings(nextPropertyId)),
  });
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
    expect(screen.getByText('Questions: 0 / 50')).toBeInTheDocument();
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

  it('resets dirty request changes and sends only changed fields with the version header', async () => {
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
        paymentMethodCollection: 'required',
        formQuestions: [
          { ...arrivalQuestion, order: 0, isActive: false },
          { ...breakfastQuestion, order: 1 },
        ],
      },
      {
        params: { propertyId: 'property-1' },
        headers: { 'If-Match': '"2026-08-25T00:00:00.000Z"' },
      },
    ]);
  });

  it('uses the refreshed server version for the next save', async () => {
    vi.mocked(api.patch)
      .mockResolvedValueOnce({ data: { data: { ...baseConfig, bookingMode: 'instant', updatedAt: '2026-08-25T00:00:01.000Z' } } } as never)
      .mockResolvedValueOnce({ data: { data: { ...baseConfig, bookingMode: 'instant', paymentMethodCollection: 'disabled', updatedAt: '2026-08-25T00:00:02.000Z' } } } as never);
    renderSettings();

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Booking mode' }),
      'instant',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Card collection' }), 'disabled');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));

    expect(vi.mocked(api.patch).mock.calls[1]?.[1]).toEqual({
      paymentMethodCollection: 'disabled',
    });
    expect(vi.mocked(api.patch).mock.calls[1]?.[2]).toEqual({
      params: { propertyId: 'property-1' },
      headers: { 'If-Match': '"2026-08-25T00:00:01.000Z"' },
    });
  });

  it('keeps a stale draft intact and reloads latest settings only on explicit review', async () => {
    const latest = {
      ...baseConfig,
      bookingMode: 'request' as const,
      paymentMethodCollection: 'disabled' as const,
      updatedAt: '2026-08-25T00:00:10.000Z',
    };
    let configReads = 0;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/v1/admin/booking-engine/config') {
        configReads += 1;
        return Promise.resolve({ data: { data: configReads === 1 ? baseConfig : latest } } as never);
      }
      return Promise.resolve({ data: { data: [] } } as never);
    });
    vi.mocked(api.patch).mockRejectedValue({ response: { status: 409 } });
    renderSettings();

    const mode = await screen.findByRole('combobox', { name: 'Booking mode' });
    await userEvent.selectOptions(mode, 'instant');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert', { name: 'Settings conflict' })).toHaveTextContent('changed since you opened this page');
    expect(mode).toHaveValue('instant');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Reload latest settings' }));
    await waitFor(() => expect(mode).toHaveValue('request'));
    expect(screen.getByRole('combobox', { name: 'Card collection' })).toHaveValue('disabled');
    expect(screen.queryByRole('alert', { name: 'Settings conflict' })).not.toBeInTheDocument();
    expect(screen.queryByText('Could not save booking engine settings.')).not.toBeInTheDocument();
  });

  it('keeps the conflict draft when reloading the latest settings fails', async () => {
    let configReads = 0;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/v1/admin/booking-engine/config') {
        configReads += 1;
        return configReads === 1
          ? Promise.resolve({ data: { data: baseConfig } } as never)
          : Promise.reject(new Error('offline'));
      }
      return Promise.resolve({ data: { data: [] } } as never);
    });
    vi.mocked(api.patch).mockRejectedValue({ response: { status: 409 } });
    renderSettings();

    const mode = await screen.findByRole('combobox', { name: 'Booking mode' });
    await userEvent.selectOptions(mode, 'instant');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reload latest settings' }));

    await waitFor(() => expect(configReads).toBe(2));
    expect(mode).toHaveValue('instant');
    expect(screen.getByRole('alert', { name: 'Settings conflict' })).toBeInTheDocument();
  });

  it('omits untouched historical definitions when another setting is saved', async () => {
    renderSettings();
    await screen.findByRole('combobox', { name: 'Booking mode' });
    await userEvent.click(screen.getByRole('switch', { name: 'Disable Arrival time' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Enable Arrival time' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Booking mode' }), 'instant');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0]?.[1]).toEqual({
      bookingMode: 'instant',
    });
  });

  it('treats an open question draft as unsaved and reset explicitly discards it', async () => {
    renderSettings();
    await screen.findByRole('combobox', { name: 'Booking mode' });
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Pending draft');

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    const reset = screen.getByRole('button', { name: 'Reset changes' });
    expect(reset).toBeEnabled();
    await userEvent.click(reset);

    expect(screen.queryByRole('heading', { name: 'Add a question' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Pending draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('keeps cached settings usable when a background refresh fails', async () => {
    const { queryClient } = renderSettings();
    const mode = await screen.findByRole('combobox', { name: 'Booking mode' });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/v1/admin/booking-engine/config') return Promise.reject(new Error('offline'));
      return Promise.resolve({ data: { data: [] } } as never);
    });

    await queryClient.invalidateQueries({ queryKey: ['booking-engine', 'config', 'property-1'] });

    expect(await screen.findByText('Latest settings could not be checked. Your loaded settings are still available.')).toBeInTheDocument();
    expect(mode).toBeInTheDocument();
    expect(mode).toHaveValue('request');
  });

  it('preserves unknown definitions on unrelated saves and blocks question publishing when one is active', async () => {
    const futureQuestion = {
      id: THIRD_ID,
      label: 'Future score',
      type: 'rating_scale',
      order: 0,
      isActive: true,
      isRequired: false,
      futureConfig: { maximum: 10 },
    };
    mockQueries({ ...baseConfig, formQuestions: [futureQuestion] });
    vi.mocked(api.patch).mockResolvedValue({
      data: { data: { ...baseConfig, bookingMode: 'instant', formQuestions: [futureQuestion], updatedAt: '2026-08-25T00:00:01.000Z' } },
    } as never);
    renderSettings();

    expect(await screen.findByText('An unsupported question is active')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Booking mode' }), 'instant');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0]?.[1]).toEqual({
      bookingMode: 'instant',
    });

    vi.mocked(api.patch).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Known question');
    await userEvent.click(screen.getByRole('button', { name: 'Save question' }));

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Use a newer dashboard before publishing changes to this guest form.')).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(screen.queryByText('Could not save booking engine settings.')).not.toBeInTheDocument();
  });

  it('discards an open Add draft when switching to an uncached property', async () => {
    const secondConfig = {
      ...baseConfig,
      id: 'config-2',
      propertyId: 'property-2',
      displayName: 'Second hotel',
      formQuestions: [],
      updatedAt: '2026-08-25T01:00:00.000Z',
    };
    let resolveSecond: ((value: unknown) => void) | undefined;
    vi.mocked(api.get).mockImplementation((url: string, options?: { params?: { propertyId?: string } }) => {
      if (url === '/v1/admin/booking-engine/config') {
        if (options?.params?.propertyId === 'property-2') {
          return new Promise((resolve) => { resolveSecond = resolve; }) as never;
        }
        return Promise.resolve({ data: { data: baseConfig } } as never);
      }
      return Promise.resolve({ data: { data: [] } } as never);
    });
    const view = renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Add question' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Phantom draft');

    view.switchProperty('property-2');
    expect(screen.getByRole('status')).toHaveTextContent('Loading booking engine settings');
    await act(async () => resolveSecond?.({ data: { data: secondConfig } }));

    expect(await screen.findByRole('textbox', { name: 'Display Name' })).toHaveValue('Second hotel');
    expect(screen.queryByDisplayValue('Phantom draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('discards an open Edit draft and mutation state when switching to a cached property', async () => {
    const secondConfig = {
      ...baseConfig,
      id: 'config-2',
      propertyId: 'property-2',
      displayName: 'Cached hotel',
      formQuestions: [],
      updatedAt: '2026-08-25T02:00:00.000Z',
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['booking-engine', 'config', 'property-2'], { data: secondConfig });
    vi.mocked(api.get).mockImplementation((url: string, options?: { params?: { propertyId?: string } }) => {
      if (url === '/v1/admin/booking-engine/config') {
        return Promise.resolve({
          data: { data: options?.params?.propertyId === 'property-2' ? secondConfig : baseConfig },
        } as never);
      }
      return Promise.resolve({ data: { data: [] } } as never);
    });
    const view = renderSettings('property-1', queryClient);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Arrival time' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Question label' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question label' }), 'Phantom edit');

    view.switchProperty('property-2');

    expect(await screen.findByRole('textbox', { name: 'Display Name' })).toHaveValue('Cached hotel');
    expect(screen.queryByDisplayValue('Phantom edit')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Edit question' })).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
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
