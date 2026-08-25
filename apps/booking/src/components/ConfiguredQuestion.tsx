import type {
  BookingApplicationAnswer,
  BookingFormQuestion,
} from '../api/types';
import { Field, inputClass, RequiredIndicator } from './Field';

interface ConfiguredQuestionProps {
  question: BookingFormQuestion;
  value?: BookingApplicationAnswer;
  onChange: (value?: BookingApplicationAnswer) => void;
  disabled?: boolean;
  invalid?: boolean;
  errorId?: string;
}

export function ConfiguredQuestion({
  question,
  value,
  onChange,
  disabled,
  invalid,
  errorId,
}: ConfiguredQuestionProps) {
  const id = `request-question-${question.id}`;
  const textValue = typeof value === 'string' ? value : '';
  const errorProps = {
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? errorId : undefined,
  } as const;

  if (question.type === 'long_text') {
    return (
      <Field label={question.label} htmlFor={id} required={question.isRequired}>
        <textarea
          id={id}
          rows={4}
          className={inputClass}
          value={textValue}
          disabled={disabled}
          required={question.isRequired}
          aria-required={question.isRequired}
          {...errorProps}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      </Field>
    );
  }

  if (question.type === 'single_select') {
    return (
      <Field label={question.label} htmlFor={id} required={question.isRequired}>
        <select
          id={id}
          className={inputClass}
          value={textValue}
          disabled={disabled}
          required={question.isRequired}
          aria-required={question.isRequired}
          {...errorProps}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Select an option</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (question.type === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    const selectedOptions = new Set(selected);
    return (
      <fieldset
        id={id}
        aria-required={question.isRequired}
        {...errorProps}
      >
        <legend className="mb-2 text-sm font-medium text-gray-700">
          {question.label}
          {question.isRequired && <RequiredIndicator />}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(question.options ?? []).map((option, index) => (
            <label
              key={option}
              className="flex items-center gap-2 rounded-brand border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#344054] focus-within:ring-2 focus-within:ring-[var(--haip-primary,#0D9488)]"
            >
              <input
                id={`${id}-option-${index}`}
                type="checkbox"
                checked={selectedOptions.has(option)}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option);
                  onChange(next.length > 0 ? next : undefined);
                }}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (question.type === 'yes_no') {
    return (
      <fieldset
        id={id}
        aria-required={question.isRequired}
        {...errorProps}
      >
        <legend className="mb-2 text-sm font-medium text-gray-700">
          {question.label}
          {question.isRequired && <RequiredIndicator />}
        </legend>
        <div className="flex gap-3">
          {[true, false].map((answer, index) => (
            <label
              key={String(answer)}
              className="flex min-w-24 items-center gap-2 rounded-brand border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#344054] focus-within:ring-2 focus-within:ring-[var(--haip-primary,#0D9488)]"
            >
              <input
                id={`${id}-option-${index}`}
                type="radio"
                name={id}
                checked={value === answer}
                disabled={disabled}
                required={question.isRequired}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                onChange={() => onChange(answer)}
              />
              {answer ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <Field label={question.label} htmlFor={id} required={question.isRequired}>
      <input
        id={id}
        type={question.type === 'date' ? 'date' : 'text'}
        className={inputClass}
        value={textValue}
        disabled={disabled}
        required={question.isRequired}
        aria-required={question.isRequired}
        {...errorProps}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </Field>
  );
}
