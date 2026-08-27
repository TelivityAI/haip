import { BadRequestException } from '@nestjs/common';
import type {
  BookingFormQuestion,
  BookingFormQuestionDefinition,
  BookingFormQuestionType,
} from '@telivityhaip/database';

/**
 * Package-local copy of apps/api's
 * `apps/api/src/modules/booking-engine/booking-form-questions.ts` — fully
 * self-contained (only depends on `@telivityhaip/database` types),
 * duplicated here rather than imported so this package never imports from
 * apps/api.
 */

const QUESTION_TYPES: readonly BookingFormQuestionType[] = [
  'short_text',
  'long_text',
  'single_select',
  'multi_select',
  'yes_no',
  'date',
];

const SELECT_TYPES = new Set<BookingFormQuestionType>(['single_select', 'multi_select']);
const MAX_QUESTIONS = 50;
const MAX_LABEL_LENGTH = 200;
const MAX_OPTIONS = 50;

type RawQuestion = {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  options?: unknown;
  order?: unknown;
  isActive?: unknown;
  isRequired?: unknown;
  [key: string]: unknown;
};

function invalid(message: string): never {
  throw new BadRequestException(message);
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isSupportedQuestion(
  question: BookingFormQuestionDefinition,
): question is BookingFormQuestion {
  return QUESTION_TYPES.includes(question.type as BookingFormQuestionType);
}

export function validateQuestionDefinitions(
  questions: unknown,
  { allowActiveUnsupported = false }: { allowActiveUnsupported?: boolean } = {},
): BookingFormQuestionDefinition[] {
  if (!Array.isArray(questions)) {
    invalid('Form questions must be an array');
  }
  if (questions.length > MAX_QUESTIONS) {
    invalid(`A booking form can contain at most ${MAX_QUESTIONS} questions`);
  }

  const ids = new Set<string>();
  return questions.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalid('Each booking form question must be an object');
    }
    const question = value as RawQuestion;
    if (typeof question.id !== 'string' || question.id.trim().length === 0) {
      invalid('Each booking form question requires an id');
    }
    if (ids.has(question.id)) {
      invalid(`Duplicate booking form question id '${question.id}'`);
    }
    ids.add(question.id);

    if (typeof question.label !== 'string' || question.label.trim().length === 0) {
      invalid(`Question '${question.id}' requires a label`);
    }
    if (question.label.length > MAX_LABEL_LENGTH) {
      invalid(`Question '${question.id}' label is too long`);
    }
    if (typeof question.type !== 'string' || question.type.trim().length === 0) {
      invalid(`Question '${question.label}' requires a type`);
    }
    if (typeof question.order !== 'number'
      || !Number.isInteger(question.order)
      || question.order < 0) {
      invalid(`Question '${question.label}' requires a non-negative integer order`);
    }
    if (typeof question.isActive !== 'boolean' || typeof question.isRequired !== 'boolean') {
      invalid(`Question '${question.label}' requires active and required flags`);
    }

    if (!QUESTION_TYPES.includes(question.type as BookingFormQuestionType)) {
      if (question.isActive && !allowActiveUnsupported) {
        invalid(`Question '${question.label}' has an unsupported active type`);
      }
      return { ...question } as BookingFormQuestionDefinition;
    }

    const options = question.options;
    const type = question.type as BookingFormQuestionType;
    if (SELECT_TYPES.has(type)) {
      if (!Array.isArray(options) || options.length === 0) {
        invalid(`Select question '${question.label}' requires at least one option`);
      }
      if (options.length > MAX_OPTIONS) {
        invalid(`Select question '${question.label}' can contain at most ${MAX_OPTIONS} options`);
      }
      const normalizedOptions = new Set<string>();
      for (const option of options) {
        if (typeof option !== 'string' || option.trim().length === 0 || option.length > 200) {
          invalid(`Select question '${question.label}' has an invalid option`);
        }
        const key = normalized(option);
        if (normalizedOptions.has(key)) {
          invalid(`Select question '${question.label}' has a duplicate option`);
        }
        normalizedOptions.add(key);
      }
    } else if (options !== undefined) {
      invalid(`Question '${question.label}' does not support options`);
    }

    return {
      id: question.id,
      label: question.label.trim(),
      type,
      ...(options ? { options: options.map((option) => (option as string).trim()) } : {}),
      order: question.order,
      isActive: question.isActive,
      isRequired: question.isRequired,
    } as BookingFormQuestion;
  });
}

/** Validates the public answer payload against the current active form schema. */
export function validateApplicationAnswers(
  questions: BookingFormQuestion[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const definitions = validateQuestionDefinitions(questions).filter(isSupportedQuestion);
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    invalid('Application answers must be an object');
  }

  const activeQuestions = definitions.filter((question) => question.isActive);
  const byId = new Map(activeQuestions.map((question) => [question.id, question]));

  for (const id of Object.keys(answers)) {
    if (!byId.has(id)) {
      invalid(`Answer for inactive or unknown question '${id}' is not allowed`);
    }
  }

  const validated: Record<string, unknown> = {};
  for (const question of activeQuestions) {
    const answer = answers[question.id];
    if (!Object.prototype.hasOwnProperty.call(answers, question.id)) {
      if (question.isRequired) {
        invalid(`${question.label} is required`);
      }
      continue;
    }

    switch (question.type) {
      case 'short_text':
      case 'long_text':
        if (typeof answer !== 'string') invalid(`${question.label} must be text`);
        if (answer.trim().length === 0) {
          if (question.isRequired) invalid(`${question.label} is required`);
          continue;
        }
        break;
      case 'single_select':
        if (typeof answer !== 'string' || !question.options!.includes(answer)) {
          invalid(`${question.label} must be one of the configured options`);
        }
        break;
      case 'multi_select':
        if (!Array.isArray(answer)) {
          invalid(`${question.label} must contain distinct configured options`);
        }
        if (answer.length === 0) {
          if (question.isRequired) invalid(`${question.label} is required`);
          continue;
        }
        if (answer.some((value) => typeof value !== 'string' || !question.options!.includes(value))
          || new Set(answer).size !== answer.length) {
          invalid(`${question.label} must contain distinct configured options`);
        }
        break;
      case 'yes_no':
        if (typeof answer !== 'boolean') invalid(`${question.label} must be yes or no`);
        break;
      case 'date':
        if (typeof answer !== 'string' || !isIsoDate(answer)) {
          invalid(`${question.label} must be an ISO date`);
        }
        break;
    }
    validated[question.id] = answer;
  }

  return validated;
}
