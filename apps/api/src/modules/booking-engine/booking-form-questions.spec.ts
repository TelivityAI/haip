import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingFormQuestion } from '@telivityhaip/database';
import { UpdateBookingEngineConfigDto } from './dto/be-admin.dto';
import { BookingEngineAdminController } from './booking-engine-admin.controller';
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

const futureInactiveQuestion = {
  id: '30000000-0000-4000-8000-000000000003',
  label: 'Legacy satisfaction score',
  type: 'rating_scale',
  order: 2,
  isActive: false,
  isRequired: false,
  futureConfig: {
    authorization: 'Bearer opaque-form-secret',
    cardNumber: 'opaque-card-number',
    cvv: '123',
    signingMaterial: 'opaque-signing-material',
    clientCertificate: 'opaque-client-certificate',
  },
  options: [{ authorization: 'Bearer option-secret' }],
};

const adminValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validateAdminBody(value: unknown) {
  return adminValidationPipe.transform(value, {
    type: 'body',
    metatype: UpdateBookingEngineConfigDto,
  });
}

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

  it('treats blank values as omissions only for optional text and multi-select questions', () => {
    const questions: BookingFormQuestion[] = [
      { id: 'notes', label: 'Notes', type: 'long_text', order: 0, isActive: true, isRequired: false },
      { id: 'dietary', label: 'Dietary needs', type: 'multi_select', options: ['Vegan'], order: 1, isActive: true, isRequired: false },
      { id: 'late', label: 'Late arrival', type: 'yes_no', order: 2, isActive: true, isRequired: false },
      { id: 'birthday', label: 'Birthday', type: 'date', order: 3, isActive: true, isRequired: false },
    ];

    expect(validateApplicationAnswers(questions, { notes: '', dietary: [] })).toEqual({});
    expect(() => validateApplicationAnswers(questions, { dietary: '' })).toThrow(/Dietary needs/);
    expect(() => validateApplicationAnswers(questions, { late: [] })).toThrow(/Late arrival/);
    expect(() => validateApplicationAnswers(questions, { birthday: [] })).toThrow(/Birthday/);
  });
});

describe('booking form DTO validation', () => {
  it('validates nested question ids and limits the form to fifty definitions', async () => {
    const malformed = {
      formQuestions: [{
        id: 'not-a-uuid',
        label: 'Purpose',
        type: 'single_select',
        options: ['Leisure'],
        order: 0,
        isActive: true,
        isRequired: true,
      }],
    };
    const oversized = {
      formQuestions: Array.from({ length: 51 }, (_, order) => ({
        id: `00000000-0000-4000-8000-${String(order).padStart(12, '0')}`,
        label: `Question ${order}`,
        type: 'short_text',
        order,
        isActive: true,
        isRequired: false,
      })),
    };

    await expect(validateAdminBody(malformed)).rejects.toBeInstanceOf(BadRequestException);
    await expect(validateAdminBody(oversized)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts legacy update bodies without a version and rejects the removed body token', async () => {
    const legacy = await validateAdminBody({ displayName: 'Renamed hotel' });

    expect(legacy).toMatchObject({ displayName: 'Renamed hotel' });
    await expect(validateAdminBody({
      displayName: 'Renamed hotel',
      expectedUpdatedAt: '2026-08-25T00:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves opaque inactive future questions but rejects active unknown types', async () => {
    const validated = await validateAdminBody({ formQuestions: [futureInactiveQuestion] });

    expect(validated.formQuestions).toEqual([futureInactiveQuestion]);
    await expect(validateAdminBody({
      formQuestions: [{ ...futureInactiveQuestion, isActive: true }],
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

function makeConfigService(
  row: Record<string, unknown>,
  paymentGateway: 'mock' | 'stripe' | 'adyen' = 'stripe',
  options: { auditInsertError?: Error } = {},
) {
  let persistedRow = row;
  let stagedRow: Record<string, unknown> | undefined;
  let stagedAudits: Record<string, unknown>[] = [];
  const returning = vi.fn().mockImplementation(async () => [stagedRow]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockImplementation((values) => {
    stagedRow = { ...persistedRow, ...values };
    return { where };
  });
  const update = vi.fn().mockReturnValue({ set });
  const selectWhere = vi.fn().mockImplementation(async () => [persistedRow]);
  const from = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from });
  const lock = vi.fn().mockImplementation(async () => [persistedRow]);
  const lockedWhere = vi.fn().mockReturnValue({ for: lock });
  const lockedFrom = vi.fn().mockReturnValue({ where: lockedWhere });
  const lockedSelect = vi.fn().mockReturnValue({ from: lockedFrom });
  const storedAudits: Record<string, unknown>[] = [];
  const insertValues = vi.fn().mockImplementation(async (values) => {
    if (options.auditInsertError) throw options.auditInsertError;
    stagedAudits.push(values);
  });
  const insert = vi.fn().mockReturnValue({ values: insertValues });
  const tx = { select: lockedSelect, update, insert };
  const transaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    stagedRow = undefined;
    stagedAudits = [];
    try {
      const result = await callback(tx);
      if (stagedRow) persistedRow = stagedRow;
      storedAudits.push(...stagedAudits);
      return result;
    } finally {
      stagedRow = undefined;
      stagedAudits = [];
    }
  });
  const db = { select, update, transaction };
  const runtimeConfig = {
    get: (key: string, fallback?: string) => {
      if (key === 'PAYMENT_GATEWAY') return paymentGateway;
      if (key === 'STRIPE_MODE') return paymentGateway === 'mock' ? 'mock' : 'test';
      return fallback;
    },
  };

  return {
    service: new BookingEngineConfigService(db as any, runtimeConfig as any),
    update,
    set,
    transaction,
    lock,
    storedAudits,
    persistedConfig: () => persistedRow,
  };
}

describe('BookingEngineConfigService request settings', () => {
  const configRow = {
    id: 'bbbbbbbb-0000-4000-b000-000000000001',
    propertyId: 'aaaaaaaa-0000-4000-a000-000000000001',
    isEnabled: true,
    displayName: 'Demo Hotel',
    logoMediaId: null,
    primaryColor: '#000000',
    accentColor: '#ffffff',
    depositPolicy: {
      type: 'first_night' as const,
      refundable: true,
      authorization: 'Bearer deposit-secret',
    },
    stripePublishableKey: 'pk_test_123',
    sellableRoomTypeIds: ['room-type-1', { authorization: 'Bearer room-list-secret' }],
    sellableRatePlanIds: ['rate-plan-1', { authorization: 'Bearer rate-list-secret' }],
    autoConfirm: false,
    bookingMode: 'request' as const,
    paymentMethodCollection: 'optional' as const,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    formQuestions: [
      { ...arrivalQuestion, order: 2 },
      { ...breakfastQuestion, order: 1, isActive: false },
      { ...futureInactiveQuestion, isActive: true },
      { id: 'notes', label: 'Notes', type: 'long_text' as const, order: 3, isActive: true, isRequired: false },
    ],
  };
  const auditActor = {
    userId: 'cccccccc-0000-4000-c000-000000000001',
    userEmail: 'operator@example.com',
    ipAddress: '203.0.113.10',
  };

  // These fixtures simulate a deployment where the optional booking-requests
  // package is installed and loaded (HAIP_BOOKING_REQUESTS=true). The
  // fail-safe gate that rejects bookingMode=request without the flag has its
  // own describe block below.
  beforeEach(() => {
    vi.stubEnv('HAIP_BOOKING_REQUESTS', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns public request settings with only active questions in display order', async () => {
    const { service } = makeConfigService(configRow);

    const publicConfig = await service.getPublicConfig(configRow.propertyId);
    expect(publicConfig).toMatchObject({
      bookingMode: 'request',
      paymentMethodCollection: 'optional',
      paymentMethodClientMode: 'stripe',
      formQuestions: [
        { id: 'arrival', order: 2 },
        { id: 'notes', order: 3 },
      ],
    });
    expect(publicConfig).not.toHaveProperty('updatedAt');
  });

  it('returns an unsupported legacy required-card policy unchanged to the public flow', async () => {
    const { service } = makeConfigService(
      { ...configRow, paymentMethodCollection: 'required' },
      'adyen',
    );

    await expect(service.getPublicConfig(configRow.propertyId)).resolves.toMatchObject({
      bookingMode: 'request',
      paymentMethodCollection: 'required',
      paymentMethodClientMode: 'unsupported',
    });
  });

  it('records one sanitized actor-attributed audit entry for a successful request configuration update', async () => {
    const { service, storedAudits } = makeConfigService(configRow);
    const updatedQuestions = [{
      id: '20000000-0000-4000-8000-000000000002',
      label: 'Arrival time',
      type: 'short_text' as const,
      order: 0,
      isActive: true,
      isRequired: true,
    }];

    await service.updateConfig(configRow.propertyId, {
      bookingMode: 'request',
      paymentMethodCollection: 'required',
      formQuestions: updatedQuestions,
      stripePublishableKey: 'pk_test_replacement',
    }, configRow.updatedAt.toISOString(), auditActor);

    expect(storedAudits).toEqual([expect.objectContaining({
      propertyId: configRow.propertyId,
      action: 'update',
      entityType: 'booking_engine_config',
      entityId: configRow.id,
      userId: auditActor.userId,
      userEmail: auditActor.userEmail,
      ipAddress: auditActor.ipAddress,
      description: 'Booking engine configuration updated',
      previousValue: expect.objectContaining({
        bookingMode: 'request',
        paymentMethodCollection: 'optional',
        sellableRoomTypeIds: ['room-type-1'],
        sellableRatePlanIds: ['rate-plan-1'],
        formQuestions: [
          { ...arrivalQuestion, order: 2 },
          { ...breakfastQuestion, order: 1, isActive: false },
          {
            id: futureInactiveQuestion.id,
            label: futureInactiveQuestion.label,
            type: futureInactiveQuestion.type,
            order: futureInactiveQuestion.order,
            isActive: true,
            isRequired: futureInactiveQuestion.isRequired,
          },
          { id: 'notes', label: 'Notes', type: 'long_text', order: 3, isActive: true, isRequired: false },
        ],
      }),
      newValue: expect.objectContaining({
        bookingMode: 'request',
        paymentMethodCollection: 'required',
        formQuestions: updatedQuestions,
      }),
    })]);
    expect(storedAudits[0]?.['previousValue']).not.toHaveProperty('stripePublishableKey');
    expect(storedAudits[0]?.['newValue']).not.toHaveProperty('stripePublishableKey');
    expect(JSON.stringify(storedAudits[0])).not.toContain('pk_test_123');
    expect(JSON.stringify(storedAudits[0])).not.toContain('pk_test_replacement');
    expect(JSON.stringify(storedAudits[0])).not.toContain('opaque-form-secret');
    expect(JSON.stringify(storedAudits[0])).not.toContain('opaque-card-number');
    expect(JSON.stringify(storedAudits[0])).not.toContain('opaque-signing-material');
    expect(JSON.stringify(storedAudits[0])).not.toContain('opaque-client-certificate');
    expect(JSON.stringify(storedAudits[0])).not.toContain('option-secret');
    expect(JSON.stringify(storedAudits[0])).not.toContain('deposit-secret');
    expect(JSON.stringify(storedAudits[0])).not.toContain('room-list-secret');
    expect(JSON.stringify(storedAudits[0])).not.toContain('rate-list-secret');
    expect((storedAudits[0]?.['previousValue'] as Record<string, unknown>)['depositPolicy'])
      .toEqual({ type: 'first_night', refundable: true });
  });

  it('returns the locked configuration without updating or auditing an empty patch', async () => {
    const { service, update, storedAudits } = makeConfigService(configRow);

    await expect(service.updateConfig(
      configRow.propertyId,
      {},
      configRow.updatedAt.toISOString(),
      auditActor,
    )).resolves.toEqual(configRow);

    expect(update).not.toHaveBeenCalled();
    expect(storedAudits).toEqual([]);
  });

  it('returns a legacy unsupported configuration unchanged for an empty patch', async () => {
    const legacyConfig = {
      ...configRow,
      paymentMethodCollection: 'required' as const,
      stripePublishableKey: null,
    };
    const { service, update, storedAudits } = makeConfigService(legacyConfig, 'adyen');

    await expect(service.updateConfig(
      legacyConfig.propertyId,
      {},
      legacyConfig.updatedAt.toISOString(),
      auditActor,
    )).resolves.toEqual(legacyConfig);

    expect(update).not.toHaveBeenCalled();
    expect(storedAudits).toEqual([]);
  });

  it('returns the locked configuration without updating normalized values already persisted', async () => {
    const normalizedRow = {
      ...configRow,
      formQuestions: [{
        id: '20000000-0000-4000-8000-000000000002',
        label: 'Travel purpose',
        type: 'single_select' as const,
        options: ['Leisure', 'Business'],
        order: 0,
        isActive: true,
        isRequired: true,
      }],
    };
    const { service, update, storedAudits } = makeConfigService(normalizedRow);

    await expect(service.updateConfig(normalizedRow.propertyId, {
      formQuestions: [{
        ...normalizedRow.formQuestions[0],
        label: '  Travel purpose  ',
        options: [' Leisure ', 'Business'],
      }],
    }, normalizedRow.updatedAt.toISOString(), auditActor)).resolves.toEqual(normalizedRow);

    expect(update).not.toHaveBeenCalled();
    expect(storedAudits).toEqual([]);
  });

  it('treats a transformed deposit-policy DTO equal to the persisted JSON as a no-op', async () => {
    const persistedConfig = {
      ...configRow,
      depositPolicy: { type: 'percentage' as const, percentage: 25, refundable: true },
    };
    const { service, update, storedAudits } = makeConfigService(persistedConfig);
    const controller = new BookingEngineAdminController(service);
    const dto = await validateAdminBody({
      depositPolicy: { type: 'percentage', percentage: 25, refundable: true },
    });

    await expect(controller.updateConfig(
      persistedConfig.propertyId,
      dto,
      auditActor,
      `"${persistedConfig.updatedAt.toISOString()}"`,
    )).resolves.toEqual(persistedConfig);

    expect(update).not.toHaveBeenCalled();
    expect(storedAudits).toEqual([]);
  });

  it('rolls back the configuration mutation when its audit insert fails', async () => {
    const auditFailure = new Error('audit storage unavailable');
    const { service, persistedConfig, storedAudits } = makeConfigService(
      configRow,
      'stripe',
      { auditInsertError: auditFailure },
    );

    await expect(service.updateConfig(
      configRow.propertyId,
      { displayName: 'Uncommitted rename' },
      configRow.updatedAt.toISOString(),
      auditActor,
    )).rejects.toThrow(auditFailure);

    expect(persistedConfig()).toEqual(configRow);
    expect(storedAudits).toEqual([]);
  });

  it('accepts a legacy admin save without a version during the compatibility window', async () => {
    const { service, set } = makeConfigService(configRow);

    await service.updateConfig(
      configRow.propertyId,
      { displayName: 'Legacy admin name' },
      undefined,
      auditActor,
    );

    expect(set.mock.calls[0][0]).toMatchObject({ displayName: 'Legacy admin name' });
  });

  it('rejects a stale If-Match version under the row lock before writing or auditing', async () => {
    const { service, update, lock, storedAudits } = makeConfigService(configRow);

    await expect(service.updateConfig(configRow.propertyId, {
      displayName: 'Stale admin name',
    }, '2026-08-24T23:59:59.000Z', auditActor)).rejects.toBeInstanceOf(ConflictException);

    expect(lock).toHaveBeenCalledWith('update');
    expect(update).not.toHaveBeenCalled();
    expect(storedAudits).toEqual([]);
  });

  it('writes only a partial patch when the If-Match version is current', async () => {
    const { service, set } = makeConfigService(configRow);

    await service.updateConfig(configRow.propertyId, {
      displayName: 'Renamed Hotel',
    }, configRow.updatedAt.toISOString(), auditActor);

    const written = set.mock.calls[0][0];
    expect(written).toMatchObject({ displayName: 'Renamed Hotel' });
    expect(written).not.toHaveProperty('bookingMode');
    expect(written).not.toHaveProperty('paymentMethodCollection');
    expect(written).not.toHaveProperty('formQuestions');
  });

  it.each(['required', 'optional'] as const)(
    'rejects %s Stripe card collection without a publishable card key',
    async (paymentMethodCollection) => {
    const { service, update, storedAudits } = makeConfigService({
      ...configRow,
      paymentMethodCollection: 'disabled',
      stripePublishableKey: null,
    });

    await expect(service.updateConfig(configRow.propertyId, {
      paymentMethodCollection,
    }, configRow.updatedAt.toISOString(), auditActor)).rejects.toThrow(/publishable/i);
    expect(update).not.toHaveBeenCalled();
    expect(storedAudits).toEqual([]);
    },
  );

  it('allows mock card collection without Stripe keys', async () => {
    const { service, set } = makeConfigService(
      { ...configRow, stripePublishableKey: null },
      'mock',
    );

    await service.updateConfig(configRow.propertyId, {
      paymentMethodCollection: 'required',
    }, configRow.updatedAt.toISOString(), auditActor);

    expect(set.mock.calls[0][0]).toMatchObject({ paymentMethodCollection: 'required' });
  });

  it.each(['required', 'optional'] as const)(
    'rejects %s card collection when the configured provider does not support saved cards',
    async (paymentMethodCollection) => {
      const { service, update, storedAudits } = makeConfigService({
        ...configRow,
        paymentMethodCollection: 'disabled',
      }, 'adyen');

      await expect(service.updateConfig(configRow.propertyId, {
        paymentMethodCollection,
      }, configRow.updatedAt.toISOString(), auditActor)).rejects.toThrow(/not supported/i);
      expect(update).not.toHaveBeenCalled();
      expect(storedAudits).toEqual([]);
    },
  );

  it('allows disabled card collection with an unsupported payment provider', async () => {
    const { service, set } = makeConfigService(configRow, 'adyen');

    await service.updateConfig(configRow.propertyId, {
      paymentMethodCollection: 'disabled',
    }, configRow.updatedAt.toISOString(), auditActor);

    expect(set.mock.calls[0][0]).toMatchObject({ paymentMethodCollection: 'disabled' });
  });

  it('does not write absent request settings during a branding-only update', async () => {
    const { service, set } = makeConfigService(configRow);

    await service.updateConfig(configRow.propertyId, {
      displayName: 'Renamed Hotel',
      bookingMode: undefined,
      paymentMethodCollection: undefined,
      formQuestions: undefined,
    }, configRow.updatedAt.toISOString(), auditActor);

    const written = set.mock.calls[0][0];
    expect(written).toMatchObject({ displayName: 'Renamed Hotel' });
    expect(written).not.toHaveProperty('bookingMode');
    expect(written).not.toHaveProperty('paymentMethodCollection');
    expect(written).not.toHaveProperty('formQuestions');
  });

  it('locks the config row while validating and applying a partial update', async () => {
    const { service, transaction, lock } = makeConfigService(configRow);

    await service.updateConfig(configRow.propertyId, {
      bookingMode: 'request',
    }, configRow.updatedAt.toISOString(), auditActor);

    expect(transaction).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledWith('update');
  });

  it('parses a strong If-Match header and forwards the authenticated audit actor', async () => {
    const { service, set, storedAudits } = makeConfigService(configRow);
    const controller = new BookingEngineAdminController(service);
    const actor = {
      userId: 'cccccccc-0000-4000-c000-000000000001',
      userEmail: 'operator@example.com',
      ipAddress: '203.0.113.10',
    };

    await controller.updateConfig(
      configRow.propertyId,
      { displayName: 'Header admin name' },
      actor,
      `"${configRow.updatedAt.toISOString()}"`,
    );
    expect(set.mock.calls[0][0]).toMatchObject({ displayName: 'Header admin name' });
    expect(storedAudits[0]).toMatchObject(actor);
    expect(() => controller.updateConfig(
      configRow.propertyId,
      { displayName: 'Malformed header' },
      actor,
      'not-an-etag',
    )).toThrow(BadRequestException);
  });

  it('validates and preserves an opaque inactive definition through DTO, controller, and service', async () => {
    const { service, set } = makeConfigService(configRow);
    const controller = new BookingEngineAdminController(service);
    const knownQuestion = {
      id: '20000000-0000-4000-8000-000000000002',
      label: '  Travel purpose  ',
      type: 'single_select',
      options: [' Leisure ', 'Business'],
      order: 0,
      isActive: true,
      isRequired: true,
    };
    const dto = await validateAdminBody({
      formQuestions: [knownQuestion, futureInactiveQuestion],
    });

    await controller.updateConfig(
      configRow.propertyId,
      dto,
      {},
      `"${configRow.updatedAt.toISOString()}"`,
    );

    expect(set.mock.calls[0][0].formQuestions).toEqual([
      { ...knownQuestion, label: 'Travel purpose', options: ['Leisure', 'Business'] },
      futureInactiveQuestion,
    ]);
  });

  it('accepts a legacy unrelated partial through DTO and controller without resending opaque data', async () => {
    const { service, set } = makeConfigService(configRow);
    const controller = new BookingEngineAdminController(service);
    const dto = await validateAdminBody({ displayName: 'Legacy partial' });

    await controller.updateConfig(configRow.propertyId, dto, auditActor);

    expect(set.mock.calls[0][0]).toMatchObject({ displayName: 'Legacy partial' });
    expect(set.mock.calls[0][0]).not.toHaveProperty('formQuestions');
  });
});

describe('BookingEngineConfigService request-mode deployment fail-safe', () => {
  const instantConfigRow = {
    id: 'bbbbbbbb-0000-4000-b000-000000000002',
    propertyId: 'aaaaaaaa-0000-4000-a000-000000000002',
    isEnabled: true,
    displayName: 'Instant Hotel',
    logoMediaId: null,
    primaryColor: '#000000',
    accentColor: '#ffffff',
    depositPolicy: { type: 'first_night' as const, refundable: true },
    stripePublishableKey: null,
    sellableRoomTypeIds: [],
    sellableRatePlanIds: [],
    autoConfirm: false,
    bookingMode: 'instant' as const,
    paymentMethodCollection: 'disabled' as const,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    formQuestions: [],
  };
  const auditActor = {
    userId: 'cccccccc-0000-4000-c000-000000000002',
    userEmail: 'operator@example.com',
    ipAddress: '203.0.113.10',
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects switching a property to request mode when HAIP_BOOKING_REQUESTS is not "true"', async () => {
    vi.stubEnv('HAIP_BOOKING_REQUESTS', '');
    const { service, update, storedAudits } = makeConfigService(instantConfigRow);

    await expect(service.updateConfig(instantConfigRow.propertyId, {
      bookingMode: 'request',
    }, instantConfigRow.updatedAt.toISOString(), auditActor))
      .rejects.toThrow(/HAIP_BOOKING_REQUESTS/);
    expect(update).not.toHaveBeenCalled();
    expect(storedAudits).toEqual([]);
  });

  it('rejects a persisted request-mode row that no longer has the deployment flag enabled', async () => {
    vi.stubEnv('HAIP_BOOKING_REQUESTS', '');
    const staleRequestRow = { ...instantConfigRow, bookingMode: 'request' as const };
    const { service, update } = makeConfigService(staleRequestRow);

    // Even a change to an unrelated field must not silently re-persist an
    // invalid request-mode row while the module is unloaded.
    await expect(service.updateConfig(staleRequestRow.propertyId, {
      displayName: 'Renamed while stale',
    }, staleRequestRow.updatedAt.toISOString(), auditActor))
      .rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('allows switching to request mode once HAIP_BOOKING_REQUESTS=true', async () => {
    vi.stubEnv('HAIP_BOOKING_REQUESTS', 'true');
    const { service, set } = makeConfigService(instantConfigRow);

    await service.updateConfig(instantConfigRow.propertyId, {
      bookingMode: 'request',
    }, instantConfigRow.updatedAt.toISOString(), auditActor);

    expect(set.mock.calls[0][0]).toMatchObject({ bookingMode: 'request' });
  });

  it('allows unrelated updates to an instant-mode property when the flag is off', async () => {
    vi.stubEnv('HAIP_BOOKING_REQUESTS', '');
    const { service, set } = makeConfigService(instantConfigRow);

    await service.updateConfig(instantConfigRow.propertyId, {
      displayName: 'Renamed instant hotel',
    }, instantConfigRow.updatedAt.toISOString(), auditActor);

    expect(set.mock.calls[0][0]).toMatchObject({ displayName: 'Renamed instant hotel' });
  });

  it('allows switching a stale request-mode row back to instant mode when the flag is off', async () => {
    vi.stubEnv('HAIP_BOOKING_REQUESTS', '');
    const staleRequestRow = { ...instantConfigRow, bookingMode: 'request' as const };
    const { service, set } = makeConfigService(staleRequestRow);

    await service.updateConfig(staleRequestRow.propertyId, {
      bookingMode: 'instant',
    }, staleRequestRow.updatedAt.toISOString(), auditActor);

    expect(set.mock.calls[0][0]).toMatchObject({ bookingMode: 'instant' });
  });
});
