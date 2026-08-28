export type BookingFormQuestionType =
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'yes_no'
  | 'date';

export type BookingFormQuestion = {
  id: string;
  label: string;
  type: BookingFormQuestionType;
  options?: string[];
  order: number;
  isActive: boolean;
  isRequired: boolean;
};

export type UnsupportedBookingFormQuestion = {
  id: string;
  label: string;
  type: string;
  order: number;
  isActive: boolean;
  isRequired: boolean;
  [key: string]: unknown;
};

export type BookingFormQuestionDefinition = BookingFormQuestion | UnsupportedBookingFormQuestion;

export const QUESTION_TYPES: readonly BookingFormQuestionType[] = [
  'short_text',
  'long_text',
  'single_select',
  'multi_select',
  'yes_no',
  'date',
];

export const SELECT_TYPES = new Set<BookingFormQuestionType>(['single_select', 'multi_select']);
export const MAX_QUESTIONS = 50;
export const MAX_OPTIONS = 50;

export function isSupportedQuestion(
  question: BookingFormQuestionDefinition,
): question is BookingFormQuestion {
  return QUESTION_TYPES.includes(question.type as BookingFormQuestionType);
}

export function hasActiveUnsupportedQuestions(questions: BookingFormQuestionDefinition[]) {
  return questions.some((question) => !isSupportedQuestion(question) && question.isActive);
}

export function questionOptionsAreValid(options: string[] | undefined) {
  if (!options || options.length === 0 || options.length > MAX_OPTIONS) return false;
  if (options.some((option) => option.trim().length === 0 || option.length > 200)) return false;
  const normalized = options.map((option) => option.trim().toLocaleLowerCase());
  return new Set(normalized).size === normalized.length;
}

export function hasDuplicateQuestionIds(questions: BookingFormQuestionDefinition[]) {
  return new Set(questions.map((question) => question.id)).size !== questions.length;
}

export function bookingQuestionsAreValid(questions: BookingFormQuestionDefinition[]) {
  return questions.length <= MAX_QUESTIONS
    && !hasDuplicateQuestionIds(questions)
    && questions.every((question) => question.id.trim().length > 0
      && question.label.trim().length > 0
      && question.label.length <= 200
      && Number.isInteger(question.order)
      && question.order >= 0
      && typeof question.isActive === 'boolean'
      && typeof question.isRequired === 'boolean'
      && (!isSupportedQuestion(question)
        || (SELECT_TYPES.has(question.type)
          ? questionOptionsAreValid(question.options)
          : question.options === undefined)));
}
