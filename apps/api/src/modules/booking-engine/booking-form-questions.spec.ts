import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import type { BookingFormQuestion } from '@telivityhaip/database';
import { UpdateBookingEngineConfigDto } from './dto/be-admin.dto';
import { BookingEngineConfigService } from './booking-engine-config.service';
import {
  validateApplicationAnswers,
  validateQuestionDefinitions,
} from './booking-form-questions';

const arrivalQuestion: BookingFormQuestion = {
  id: 'arrival',
  label: 'Arrival time',
  type: 'short_text',
  order: 0,
  isActive: true,
  isRequired: true,
};

const breakfastQuestion: BookingFormQuestion = {
  id: 'breakfast',
  label: 'Breakfast preference',
  type: 'single_select',
  options: ['Continental', 'Full English'],
  order: 1,
  isActive: true,
  isRequired: false,
};

describe('validateQuestionDefinitions', () => {
  it('rejects duplicate question ids and missing select options', () => {
    expect(() => validateQuestionDefinitions([
      { id: 'purpose', label: 'Purpose', type: 'single_select', options: [], order: 0, isActive: true, isRequired: true },
      { id: 'purpose', label: 'Again', type: 'short_text', order: 1, isActive: true, isRequired: false },
    ])).toThrow(BadRequestException);
  });

  it('rejects options that only differ by surrounding whitespace or case', () => {
    expect(() => validateQuestionDefinitions([
      {
        id: 'transport',
        label: 'Transport',
        type: 'multi_select',
        options: ['Taxi', ' taxi '],
        order: 0,
        isActive: true,
        isRequired: false,
      },
    ])).toThrow(/duplicate option/i);
  });

  it('rejects more than fifty question definitions', () => {
    const questions = Array.from({ length: 51 }, (_, order) => ({
      id: `question-${order}`,
      label: `Question ${order}`,
      type: 'short_text' as const,
      order,
      isActive: true,
      isRequired: false,
    }));

    expect(() => validateQuestionDefinitions(questions)).toThrow(/50/);
  });

  it('keeps valid definitions in their configured order', () => {
    const questions = [breakfastQuestion, arrivalQuestion];

    expect(validateQuestionDefinitions(questions)).toEqual(questions);
  });
});

describe('validateApplicationAnswers', () => {
  it('rejects a missing required answer', () => {
    expect(() => validateApplicationAnswers([arrivalQuestion], {})).toThrow(/Arrival time/);
  });

  it('accepts values matching each question type', () => {
    const questions: BookingFormQuestion[] = [
      arrivalQuestion,
      breakfastQuestion,
      { id: 'dietary', label: 'Dietary needs', type: 'multi_select', options: ['Vegan', 'Gluten-free'], order: 2, isActive: true, isRequired: true },
      { id: 'late', label: 'Late arrival', type: 'yes_no', order: 3, isActive: true, isRequired: true },
      { id: 'birthday', label: 'Birthday', type: 'date', order: 4, isActive: true, isRequired: false },
      { id: 'notes', label: 'Notes', type: 'long_text', order: 5, isActive: true, isRequired: false },
      { id: 'retired', label: 'Retired', type: 'short_text', order: 6, isActive: false, isRequired: true },
    ];
    const answers = {
      arrival: '22:00',
      breakfast: 'Continental',
      dietary: ['Vegan', 'Gluten-free'],
      late: false,
      birthday: '1990-12-31',
      notes: 'Please call on arrival.',
    };

    expect(validateApplicationAnswers(questions, answers)).toEqual(answers);
  });

  it('rejects answers with the wrong type, unsupported options, or inactive question ids', () => {
    const questions: BookingFormQuestion[] = [
      breakfastQuestion,
      { id: 'late', label: 'Late arrival', type: 'yes_no', order: 1, isActive: true, isRequired: false },
      { id: 'retired', label: 'Retired', type: 'short_text', order: 2, isActive: false, isRequired: false },
    ];

    expect(() => validateApplicationAnswers(questions, { breakfast: ['Continental'] })).toThrow(/Breakfast preference/);
    expect(() => validateApplicationAnswers(questions, { breakfast: 'Vegan' })).toThrow(/Breakfast preference/);
    expect(() => validateApplicationAnswers(questions, { late: 'yes' })).toThrow(/Late arrival/);
    expect(() => validateApplicationAnswers(questions, { retired: 'legacy answer' })).toThrow(/retired/i);
  });
});

describe('booking form DTO validation', () => {
  it('validates nested question ids and limits the form to fifty definitions', async () => {
    const malformed = plainToInstance(UpdateBookingEngineConfigDto, {
      formQuestions: [{
        id: 'not-a-uuid',
        label: 'Purpose',
        type: 'single_select',
        options: ['Leisure'],
        order: 0,
        isActive: true,
        isRequired: true,
      }],
    });
    const oversized = plainToInstance(UpdateBookingEngineConfigDto, {
      formQuestions: Array.from({ length: 51 }, (_, order) => ({
        id: `00000000-0000-4000-8000-${String(order).padStart(12, '0')}`,
        label: `Question ${order}`,
        type: 'short_text',
        order,
        isActive: true,
        isRequired: false,
      })),
    });

    expect(await validate(malformed)).not.toEqual([]);
    expect(await validate(oversized)).not.toEqual([]);
  });
});

function makeConfigService(row: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([row]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const selectWhere = vi.fn().mockResolvedValue([row]);
  const from = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from });
  const db = { select, update };

  return {
    service: new BookingEngineConfigService(db as any),
    update,
    set,
  };
}

describe('BookingEngineConfigService request settings', () => {
  const configRow = {
    propertyId: 'aaaaaaaa-0000-4000-a000-000000000001',
    isEnabled: true,
    displayName: 'Demo Hotel',
    logoMediaId: null,
    primaryColor: '#000000',
    accentColor: '#ffffff',
    depositPolicy: { type: 'first_night' as const, refundable: true },
    stripePublishableKey: 'pk_test_123',
    sellableRoomTypeIds: [],
    sellableRatePlanIds: [],
    autoConfirm: false,
    bookingMode: 'request' as const,
    paymentMethodCollection: 'optional' as const,
    formQuestions: [
      { ...arrivalQuestion, order: 2 },
      { ...breakfastQuestion, order: 1, isActive: false },
      { id: 'notes', label: 'Notes', type: 'long_text' as const, order: 3, isActive: true, isRequired: false },
    ],
  };

  it('returns public request settings with only active questions in display order', async () => {
    const { service } = makeConfigService(configRow);

    await expect(service.getPublicConfig(configRow.propertyId)).resolves.toMatchObject({
      bookingMode: 'request',
      paymentMethodCollection: 'optional',
      formQuestions: [
        { id: 'arrival', order: 2 },
        { id: 'notes', order: 3 },
      ],
    });
  });

  it('rejects required request card collection without a publishable card key', async () => {
    const { service, update } = makeConfigService({ ...configRow, stripePublishableKey: null });

    await expect(service.updateConfig(configRow.propertyId, {
      paymentMethodCollection: 'required',
    })).rejects.toThrow(/publishable/i);
    expect(update).not.toHaveBeenCalled();
  });
});
