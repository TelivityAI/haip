import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  QUESTION_TYPES,
  SELECT_TYPES,
  hasDuplicateQuestionIds,
  isSupportedQuestion,
  questionOptionsAreValid,
  type BookingFormQuestion,
  type BookingFormQuestionDefinition,
  type BookingFormQuestionType,
} from './booking-request-config';

interface BookingQuestionBuilderProps {
  questions: BookingFormQuestionDefinition[];
  onChange: (questions: BookingFormQuestionDefinition[]) => void;
  disabled?: boolean;
  idFactory?: () => string;
  onEditorOpenChange?: (isOpen: boolean) => void;
}

function defaultIdFactory() {
  return crypto.randomUUID();
}

function createUniqueId(questions: BookingFormQuestionDefinition[], idFactory: () => string) {
  const ids = new Set(questions.map((question) => question.id));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = idFactory();
    if (!ids.has(id)) return id;
  }
  throw new Error('Could not create a unique question id');
}

function sortedQuestions(questions: BookingFormQuestionDefinition[]) {
  return questions
    .map((question, index) => ({ question, index }))
    .sort((left, right) => left.question.order - right.question.order || left.index - right.index)
    .map(({ question }) => question);
}

function normalizedQuestions(questions: BookingFormQuestionDefinition[]) {
  return sortedQuestions(questions).map((question, order) => ({ ...question, order }));
}

export default function BookingQuestionBuilder({
  questions,
  onChange,
  disabled = false,
  idFactory = defaultIdFactory,
  onEditorOpenChange,
}: BookingQuestionBuilderProps) {
  const { t } = useTranslation();
  const orderedQuestions = useMemo(() => sortedQuestions(questions), [questions]);
  const [draft, setDraft] = useState<BookingFormQuestion | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [optionKeys, setOptionKeys] = useState<string[]>([]);
  const nextOptionKey = useRef(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusRef = useRef<'add' | string>('add');
  const duplicateIds = hasDuplicateQuestionIds(questions);

  useEffect(() => {
    if (draft) labelInputRef.current?.focus();
  }, [draft?.id]);

  const restoreFocus = (target = returnFocusRef.current) => {
    window.setTimeout(() => {
      if (target === 'add') addButtonRef.current?.focus();
      else editButtonRefs.current.get(target)?.focus();
    }, 0);
  };

  const openNewQuestion = () => {
    if (disabled || questions.length >= MAX_QUESTIONS || duplicateIds) return;
    try {
      const nextOrder = questions.length === 0
        ? 0
        : Math.max(...questions.map((question) => question.order)) + 1;
      setDraft({
        id: createUniqueId(questions, idFactory),
        label: '',
        type: 'short_text',
        order: nextOrder,
        isActive: true,
        isRequired: false,
      });
      setEditingId(null);
      returnFocusRef.current = 'add';
      setOptionKeys([]);
      setBuilderError(null);
      onEditorOpenChange?.(true);
    } catch {
      setBuilderError(t('bookingEngine.questions.idError'));
    }
  };

  const openEditQuestion = (question: BookingFormQuestion) => {
    if (disabled) return;
    setDraft({
      id: question.id,
      label: question.label,
      type: question.type,
      ...(question.options ? { options: [...question.options] } : {}),
      order: question.order,
      isActive: question.isActive,
      isRequired: question.isRequired,
    });
    setEditingId(question.id);
    returnFocusRef.current = question.id;
    setOptionKeys((question.options ?? []).map((_, index) => `${question.id}-existing-${index}`));
    setBuilderError(null);
    onEditorOpenChange?.(true);
  };

  const closeEditor = (restore = true) => {
    const target = returnFocusRef.current;
    setDraft(null);
    setEditingId(null);
    setOptionKeys([]);
    onEditorOpenChange?.(false);
    if (restore) restoreFocus(target);
  };

  const selectType = (type: BookingFormQuestionType) => {
    if (SELECT_TYPES.has(type) && draft && !SELECT_TYPES.has(draft.type)) {
      setOptionKeys([`${draft.id}-option-${nextOptionKey.current++}`]);
    } else if (!SELECT_TYPES.has(type)) {
      setOptionKeys([]);
    }
    setDraft((current) => {
      if (!current) return current;
      if (SELECT_TYPES.has(type)) {
        return {
          ...current,
          type,
          options: SELECT_TYPES.has(current.type) ? [...(current.options ?? [''])] : [''],
        };
      }
      const withoutOptions: BookingFormQuestion = { ...current, type };
      delete withoutOptions.options;
      return withoutOptions;
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const label = draft.label.trim();
    const options = SELECT_TYPES.has(draft.type)
      ? draft.options?.map((option) => option.trim())
      : undefined;
    if (!label || label.length > 200) return;
    if (SELECT_TYPES.has(draft.type) && !questionOptionsAreValid(options)) return;

    const saved: BookingFormQuestion = {
      id: draft.id,
      label,
      type: draft.type,
      ...(options ? { options } : {}),
      order: draft.order,
      isActive: draft.isActive,
      isRequired: draft.isRequired,
    };
    onChange(normalizedQuestions(editingId
      ? questions.map((question) => question.id === editingId ? saved : question)
      : [...questions, saved]));
    if (!editingId && questions.length + 1 >= MAX_QUESTIONS) {
      returnFocusRef.current = saved.id;
    }
    closeEditor();
  };

  const moveQuestion = (id: string, direction: -1 | 1) => {
    if (disabled || draft) return;
    const currentIndex = orderedQuestions.findIndex((question) => question.id === id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedQuestions.length) return;
    const moved = [...orderedQuestions];
    const [question] = moved.splice(currentIndex, 1);
    moved.splice(targetIndex, 0, question!);
    const orderById = new Map(moved.map((item, order) => [item.id, order]));
    onChange(questions.map((item) => ({ ...item, order: orderById.get(item.id)! })));
  };

  const toggleQuestion = (question: BookingFormQuestionDefinition) => {
    if (disabled || draft || !isSupportedQuestion(question)) return;
    onChange(questions.map((item) => item.id === question.id
      ? { ...item, isActive: !item.isActive }
      : item));
  };

  const removeQuestion = (id: string) => {
    if (disabled || draft) return;
    onChange(normalizedQuestions(questions.filter((question) => question.id !== id)));
    if (editingId === id) closeEditor();
    else restoreFocus('add');
  };

  const updateOption = (index: number, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const options = [...(current.options ?? [])];
      options[index] = value;
      return { ...current, options };
    });
  };

  const addOption = () => {
    if (draft && (draft.options?.length ?? 0) < MAX_OPTIONS) {
      const key = `${draft.id}-option-${nextOptionKey.current++}`;
      setOptionKeys((current) => [...current, key]);
    }
    setDraft((current) => current && (current.options?.length ?? 0) < MAX_OPTIONS
      ? { ...current, options: [...(current.options ?? []), ''] }
      : current);
  };

  const moveOption = (index: number, direction: -1 | 1) => {
    setOptionKeys((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const moved = [...current];
      [moved[index], moved[targetIndex]] = [moved[targetIndex]!, moved[index]!];
      return moved;
    });
    setDraft((current) => {
      if (!current?.options) return current;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.options.length) return current;
      const options = [...current.options];
      [options[index], options[targetIndex]] = [options[targetIndex]!, options[index]!];
      return { ...current, options };
    });
  };

  const removeOption = (index: number) => {
    setOptionKeys((current) => current.filter((_, optionIndex) => optionIndex !== index));
    setDraft((current) => current?.options
      ? { ...current, options: current.options.filter((_, optionIndex) => optionIndex !== index) }
      : current);
  };

  return (
    <section aria-labelledby="guest-form-blueprint-title" className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 id="guest-form-blueprint-title" className="text-sm font-semibold text-telivity-navy">
            {t('bookingEngine.questions.title')}
          </h2>
          <p className="text-xs text-telivity-slate mt-1 max-w-2xl">
            {t('bookingEngine.questions.description')}
          </p>
          <p className="text-[11px] font-medium text-telivity-slate mt-2">
            {t('bookingEngine.questions.count', { count: questions.length, max: MAX_QUESTIONS })}
          </p>
        </div>
        <button
          ref={addButtonRef}
          type="button"
          onClick={openNewQuestion}
          disabled={disabled || !!draft || questions.length >= MAX_QUESTIONS || duplicateIds}
          className="inline-flex items-center justify-center gap-2 bg-telivity-deep-blue text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2 shrink-0 motion-reduce:transition-none"
        >
          <Plus size={15} aria-hidden="true" />
          {t('bookingEngine.questions.add')}
        </button>
      </div>

      {(duplicateIds || builderError) && (
        <p role="alert" className="mx-4 sm:mx-5 mt-4 text-xs text-red-600">
          {builderError ?? t('bookingEngine.questions.duplicateIds')}
        </p>
      )}

      {questions.some((question) => !isSupportedQuestion(question) && question.isActive) && (
        <div role="alert" className="mx-4 sm:mx-5 mt-4 border-l-4 border-telivity-orange bg-telivity-orange/5 rounded-lg px-3 py-2.5">
          <p className="text-xs font-semibold text-telivity-navy">{t('bookingEngine.questions.unsupportedActiveTitle')}</p>
          <p className="text-xs text-telivity-slate mt-1">{t('bookingEngine.questions.unsupportedActiveDescription')}</p>
        </div>
      )}

      {orderedQuestions.length === 0 && !draft ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-telivity-navy">{t('bookingEngine.questions.emptyTitle')}</p>
          <p className="text-xs text-telivity-slate mt-1">{t('bookingEngine.questions.emptyDescription')}</p>
        </div>
      ) : (
        <QuestionList
          questions={orderedQuestions}
          disabled={disabled || !!draft}
          onMove={moveQuestion}
          onToggle={toggleQuestion}
          onEdit={(question) => isSupportedQuestion(question) && openEditQuestion(question)}
          onRemove={removeQuestion}
          setEditButtonRef={(id, element) => {
            if (element) editButtonRefs.current.set(id, element);
            else editButtonRefs.current.delete(id);
          }}
        />
      )}

      {draft && <QuestionEditor
        draft={draft}
        setDraft={setDraft}
        editing={!!editingId}
        optionKeys={optionKeys}
        labelInputRef={labelInputRef}
        onTypeChange={selectType}
        onUpdateOption={updateOption}
        onAddOption={addOption}
        onMoveOption={moveOption}
        onRemoveOption={removeOption}
        onSave={saveDraft}
        onCancel={closeEditor}
      />}
    </section>
  );
}

function QuestionList({
  questions,
  disabled,
  onMove,
  onToggle,
  onEdit,
  onRemove,
  setEditButtonRef,
}: {
  questions: BookingFormQuestionDefinition[];
  disabled: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
  onToggle: (question: BookingFormQuestionDefinition) => void;
  onEdit: (question: BookingFormQuestionDefinition) => void;
  onRemove: (id: string) => void;
  setEditButtonRef: (id: string, element: HTMLButtonElement | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <ol className="divide-y divide-gray-100">
      {questions.map((question, index) => {
        const supported = isSupportedQuestion(question);
        return (
          <li key={question.id} className="px-4 sm:px-5 py-3">
            <div className="flex items-start gap-3">
              <span className="w-7 pt-0.5 text-xs font-semibold tabular-nums text-telivity-slate" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-telivity-navy break-words">{question.label}</span>
                  <span className="rounded-full bg-telivity-deep-blue/10 px-2 py-0.5 text-[11px] font-medium text-telivity-deep-blue">
                    {supported
                      ? t(`bookingEngine.questions.types.${question.type}`)
                      : t('bookingEngine.questions.unsupportedType')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${question.isRequired ? 'bg-telivity-orange/10 text-telivity-navy' : 'bg-gray-100 text-telivity-slate'}`}>
                    {question.isRequired ? t('bookingEngine.questions.required') : t('bookingEngine.questions.optional')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${question.isActive ? 'bg-telivity-deep-blue/10 text-telivity-deep-blue' : 'bg-gray-100 text-telivity-slate'}`}>
                    {question.isActive ? t('bookingEngine.questions.active') : t('bookingEngine.questions.inactive')}
                  </span>
                </div>
                {Array.isArray(question.options) && (
                  <p className="text-xs text-telivity-slate mt-1 truncate">
                    {question.options.join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-1 shrink-0">
                <IconButton
                  label={t('bookingEngine.questions.moveUp', { label: question.label })}
                  onClick={() => onMove(question.id, -1)}
                  disabled={disabled || index === 0}
                ><ArrowUp size={14} /></IconButton>
                <IconButton
                  label={t('bookingEngine.questions.moveDown', { label: question.label })}
                  onClick={() => onMove(question.id, 1)}
                  disabled={disabled || index === questions.length - 1}
                ><ArrowDown size={14} /></IconButton>
                <button
                  type="button"
                  role="switch"
                  aria-checked={question.isActive}
                  aria-label={question.isActive
                    ? t('bookingEngine.questions.disable', { label: question.label })
                    : t('bookingEngine.questions.enable', { label: question.label })}
                  onClick={() => onToggle(question)}
                  disabled={disabled || !supported}
                  className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none ${question.isActive ? 'bg-telivity-deep-blue' : 'bg-telivity-slate'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform motion-reduce:transition-none ${question.isActive ? 'translate-x-4' : ''}`} />
                </button>
                <IconButton
                  label={t('bookingEngine.questions.edit', { label: question.label })}
                  onClick={() => onEdit(question)}
                  disabled={disabled || !supported}
                  buttonRef={(element) => setEditButtonRef(question.id, element)}
                ><Pencil size={14} /></IconButton>
                <IconButton
                  label={t('bookingEngine.questions.remove', { label: question.label })}
                  onClick={() => onRemove(question.id)}
                  disabled={disabled || !supported}
                  danger
                ><Trash2 size={14} /></IconButton>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function QuestionEditor({
  draft,
  setDraft,
  editing,
  optionKeys,
  labelInputRef,
  onTypeChange,
  onUpdateOption,
  onAddOption,
  onMoveOption,
  onRemoveOption,
  onSave,
  onCancel,
}: {
  draft: BookingFormQuestion;
  setDraft: Dispatch<SetStateAction<BookingFormQuestion | null>>;
  editing: boolean;
  optionKeys: string[];
  labelInputRef: RefObject<HTMLInputElement>;
  onTypeChange: (type: BookingFormQuestionType) => void;
  onUpdateOption: (index: number, value: string) => void;
  onAddOption: () => void;
  onMoveOption: (index: number, direction: -1 | 1) => void;
  onRemoveOption: (index: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const optionValues = draft.options ?? [];
  const hasBlankOption = optionValues.some((option) => option.trim().length === 0);
  const normalizedOptions = optionValues.map((option) => option.trim().toLocaleLowerCase());
  const hasDuplicateOption = !hasBlankOption
    && new Set(normalizedOptions).size !== normalizedOptions.length;
  const optionErrorId = hasBlankOption
    ? 'booking-question-options-blank'
    : hasDuplicateOption
      ? 'booking-question-options-duplicate'
      : undefined;
  const labelInvalid = draft.label.trim().length === 0;
  const draftValid = !labelInvalid
    && draft.label.trim().length <= 200
    && (!SELECT_TYPES.has(draft.type) || questionOptionsAreValid(draft.options));

  return (
    <div className="border-t border-gray-100 bg-telivity-light-grey/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-telivity-navy">
          {editing ? t('bookingEngine.questions.editTitle') : t('bookingEngine.questions.addTitle')}
        </h3>
        <button type="button" onClick={onCancel} aria-label={t('bookingEngine.questions.cancelEditor')} className="p-1.5 rounded-lg text-telivity-slate hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue motion-reduce:transition-none">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="booking-question-label" className="block text-xs font-medium text-telivity-slate mb-1">{t('bookingEngine.questions.label')}</label>
          <input
            ref={labelInputRef}
            id="booking-question-label"
            type="text"
            maxLength={200}
            value={draft.label}
            aria-invalid={labelInvalid}
            aria-describedby={labelInvalid ? 'booking-question-label-error' : undefined}
            onChange={(event) => setDraft((current) => current ? { ...current, label: event.target.value } : current)}
            className="w-full border border-telivity-slate rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-deep-blue focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
          />
          {labelInvalid && <p id="booking-question-label-error" className="text-xs text-red-600 mt-1">{t('bookingEngine.questions.labelRequired')}</p>}
        </div>
        <div>
          <label htmlFor="booking-question-type" className="block text-xs font-medium text-telivity-slate mb-1">{t('bookingEngine.questions.type')}</label>
          <select id="booking-question-type" value={draft.type} onChange={(event) => onTypeChange(event.target.value as BookingFormQuestionType)} className="w-full border border-telivity-slate rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-deep-blue focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
            {QUESTION_TYPES.map((type) => <option key={type} value={type}>{t(`bookingEngine.questions.types.${type}`)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
        <label className="inline-flex items-center gap-2 text-sm text-telivity-navy cursor-pointer">
          <input type="checkbox" checked={draft.isRequired} onChange={(event) => setDraft((current) => current ? { ...current, isRequired: event.target.checked } : current)} className="accent-telivity-deep-blue focus:ring-telivity-deep-blue" />
          {t('bookingEngine.questions.requiredQuestion')}
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-telivity-navy cursor-pointer">
          <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => current ? { ...current, isActive: event.target.checked } : current)} className="accent-telivity-deep-blue focus:ring-telivity-deep-blue" />
          {t('bookingEngine.questions.activeQuestion')}
        </label>
      </div>

      {SELECT_TYPES.has(draft.type) && (
        <fieldset className="mt-5">
          <legend className="text-xs font-semibold text-telivity-slate mb-2">{t('bookingEngine.questions.options')}</legend>
          <div className="flex justify-end -mt-7 mb-2">
            <button type="button" onClick={onAddOption} disabled={optionValues.length >= MAX_OPTIONS} className="inline-flex items-center gap-1 text-sm font-semibold text-telivity-deep-blue disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue rounded">
              <Plus size={14} aria-hidden="true" /> {t('bookingEngine.questions.addOption')}
            </button>
          </div>
          <div className="space-y-2">
            {optionValues.map((option, index) => (
              <div key={optionKeys[index]} className="flex items-center gap-2">
                <input type="text" maxLength={200} aria-label={t('bookingEngine.questions.optionLabel', { number: index + 1 })} aria-invalid={!!optionErrorId} aria-describedby={optionErrorId} value={option} onChange={(event) => onUpdateOption(index, event.target.value)} className="min-w-0 flex-1 border border-telivity-slate rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-deep-blue focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
                <IconButton label={t('bookingEngine.questions.moveOptionUp', { number: index + 1 })} onClick={() => onMoveOption(index, -1)} disabled={index === 0}><ArrowUp size={14} /></IconButton>
                <IconButton label={t('bookingEngine.questions.moveOptionDown', { number: index + 1 })} onClick={() => onMoveOption(index, 1)} disabled={index === optionValues.length - 1}><ArrowDown size={14} /></IconButton>
                <IconButton label={t('bookingEngine.questions.removeOption', { number: index + 1 })} onClick={() => onRemoveOption(index)} danger><Trash2 size={14} /></IconButton>
              </div>
            ))}
          </div>
          {optionValues.length === 0 && <p className="text-xs text-red-700 mt-2">{t('bookingEngine.questions.optionRequired')}</p>}
          {hasBlankOption && <p id="booking-question-options-blank" className="text-xs text-red-700 mt-2">{t('bookingEngine.questions.optionBlank')}</p>}
          {hasDuplicateOption && <p id="booking-question-options-duplicate" className="text-xs text-red-700 mt-2">{t('bookingEngine.questions.optionDuplicate')}</p>}
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <button type="button" onClick={onSave} disabled={!draftValid} className="bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2">{t('bookingEngine.questions.save')}</button>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-telivity-slate hover:text-telivity-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue rounded">{t('bookingEngine.questions.cancel')}</button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  danger = false,
  buttonRef,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  buttonRef?: (element: HTMLButtonElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded-md disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue motion-reduce:transition-none ${danger ? 'text-red-600 hover:bg-red-50' : 'text-telivity-slate hover:bg-telivity-light-grey hover:text-telivity-navy'}`}
    >
      {children}
    </button>
  );
}
