import type {
  BookingApplicationAnswer,
  BookingFormQuestion,
} from '../api/types';
import { Field, inputClass } from './Field';

interface ConfiguredQuestionProps {
  question: BookingFormQuestion;
  value?: BookingApplicationAnswer;
  onChange: (value?: BookingApplicationAnswer) => void;
}

export function ConfiguredQuestion({
  question,
  value,
  onChange,
}: ConfiguredQuestionProps) {
  const id = `request-question-${question.id}`;
  const textValue = typeof value === 'string' ? value : '';

  if (question.type === 'long_text') {
    return (
      <Field label={question.label} htmlFor={id} required={question.isRequired}>
        <textarea
          id={id}
          rows={4}
          className={inputClass}
          value={textValue}
          aria-required={question.isRequired}
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
          aria-required={question.isRequired}
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
    return (
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700">
          {question.label}
          {question.isRequired && <span className="text-red-500"> *</span>}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(question.options ?? []).map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 rounded-brand border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#344054] focus-within:ring-2 focus-within:ring-[var(--haip-primary,#0D9488)]"
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
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
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-700">
          {question.label}
          {question.isRequired && <span className="text-red-500"> *</span>}
        </legend>
        <div className="flex gap-3">
          {[true, false].map((answer) => (
            <label
              key={String(answer)}
              className="flex min-w-24 items-center gap-2 rounded-brand border border-[#D0D5DD] bg-white px-3 py-2 text-sm text-[#344054] focus-within:ring-2 focus-within:ring-[var(--haip-primary,#0D9488)]"
            >
              <input
                type="radio"
                name={id}
                checked={value === answer}
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
        aria-required={question.isRequired}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </Field>
  );
}
