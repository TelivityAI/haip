import { BadRequestException } from '@nestjs/common';
import type { BookingFormQuestion, BookingFormQuestionType } from '@telivityhaip/database';

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

/**
 * Validates the property-owned application form schema before it is persisted.
 * UUID validation remains at the HTTP boundary because imported historical form
 * snapshots may be read through this pure function too.
 */
export function validateQuestionDefinitions(questions: BookingFormQuestion[]): BookingFormQuestion[] {
  if (!Array.isArray(questions)) {
    invalid('Form questions must be an array');
  }
  if (questions.length > MAX_QUESTIONS) {
    invalid(`A booking form can contain at most ${MAX_QUESTIONS} questions`);
  }

  const ids = new Set<string>();
  return questions.map((question) => {
    if (!question || typeof question.id !== 'string' || question.id.trim().length === 0) {
      invalid('Each booking form question requires an id');
    }
    if (ids.has(question.id)) {
      invalid(`Duplicate booking form question id '${question.id}'`);
    }
    ids.add(question.id);

    if (typeof question.label !== 'string' || question.label.trim().length === 0) {
      invalid(`Question '${question.id}' requires a label`);
    }
    if (!QUESTION_TYPES.includes(question.type)) {
      invalid(`Question '${question.label}' has an unsupported type`);
    }
    if (!Number.isInteger(question.order) || question.order < 0) {
      invalid(`Question '${question.label}' requires a non-negative integer order`);
    }
    if (typeof question.isActive !== 'boolean' || typeof question.isRequired !== 'boolean') {
      invalid(`Question '${question.label}' requires active and required flags`);
    }

    const options = question.options;
    if (SELECT_TYPES.has(question.type)) {
      if (!Array.isArray(options) || options.length === 0) {
        invalid(`Select question '${question.label}' requires at least one option`);
      }
      const normalizedOptions = new Set<string>();
      for (const option of options) {
        if (typeof option !== 'string' || option.trim().length === 0) {
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

    return { ...question, ...(options ? { options: [...options] } : {}) };
  });
}

/** Validates the public answer payload against the current active form schema. */
export function validateApplicationAnswers(
  questions: BookingFormQuestion[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const definitions = validateQuestionDefinitions(questions);
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
