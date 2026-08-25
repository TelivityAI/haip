import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  BookingApplicationAnswer,
  BookingApplicationAnswers,
  BookingFormQuestion,
} from '../api/types';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { ConfiguredQuestion } from '../components/ConfiguredQuestion';
import { Field, inputClass } from '../components/Field';
import { RequestFlowFrame } from '../components/RequestStayDocket';
import { useBookingFlow } from '../context/BookingFlowContext';
import { useConfig } from '../context/ConfigContext';
import { requestPayload } from '../lib/requestPayload';

function missingRequiredAnswer(
  questions: BookingFormQuestion[],
  answers: BookingApplicationAnswers,
): { message: string; invalidIds: string[]; focusId: string } | undefined {
  const missing = questions.filter((question) => {
    if (!question.isRequired) return false;
    const answer = answers[question.id];
    return (
      answer === undefined ||
      (typeof answer === 'string' && answer.trim().length === 0) ||
      (Array.isArray(answer) && answer.length === 0)
    );
  });
  const first = missing[0];
  if (!first) return undefined;
  const baseId = `request-question-${first.id}`;
  return {
    message: `${first.label} is required.`,
    invalidIds: missing.map((question) => question.id),
    focusId:
      first.type === 'yes_no' || first.type === 'multi_select'
        ? `${baseId}-option-0`
        : baseId,
  };
}

interface ValidationIssue {
  message: string;
  invalidIds: string[];
  focusId: string;
}

const APPLICATION_ERROR_ID = 'request-application-error';

export function RequestApplication() {
  const navigate = useNavigate();
  const { config, isLoading } = useConfig();
  const flow = useBookingFlow();
  const [firstName, setFirstName] = useState(flow.guest?.firstName ?? '');
  const [lastName, setLastName] = useState(flow.guest?.lastName ?? '');
  const [email, setEmail] = useState(flow.guest?.email ?? '');
  const [phone, setPhone] = useState(flow.guest?.phone ?? '');
  const [specialRequests, setSpecialRequests] = useState(
    flow.guest?.specialRequests ?? '',
  );
  const [answers, setAnswers] = useState<BookingApplicationAnswers>(() => ({
    ...flow.applicationAnswers,
  }));
  const [validationError, setValidationError] = useState<ValidationIssue>();

  useEffect(() => {
    if (
      !flow.criteria ||
      !flow.roomType ||
      !flow.rate ||
      !flow.quote
    ) {
      navigate('/', { replace: true });
    }
  }, [flow.criteria, flow.roomType, flow.rate, flow.quote, navigate]);

  useEffect(() => {
    if (!isLoading && config?.bookingMode !== 'request') {
      navigate('/guest', { replace: true });
    }
  }, [config?.bookingMode, isLoading, navigate]);

  if (
    isLoading ||
    config?.bookingMode !== 'request' ||
    !flow.criteria ||
    !flow.roomType ||
    !flow.rate ||
    !flow.quote
  ) {
    return null;
  }

  const setAnswer = (id: string, value?: BookingApplicationAnswer) => {
    setAnswers((current) => {
      if (value === undefined) {
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: value };
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cleanGuest = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      specialRequests: specialRequests.trim() || undefined,
    };

    const missingCoreFields = [
      !cleanGuest.firstName ? 'request-first-name' : undefined,
      !cleanGuest.lastName ? 'request-last-name' : undefined,
      !cleanGuest.email ? 'request-email' : undefined,
    ].filter((id): id is string => Boolean(id));
    if (missingCoreFields.length > 0) {
      const issue = {
        message: 'First name, last name and email are required.',
        invalidIds: missingCoreFields,
        focusId: missingCoreFields[0]!,
      };
      setValidationError(issue);
      document.getElementById(issue.focusId)?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanGuest.email)) {
      const issue = {
        message: 'Please enter a valid email address.',
        invalidIds: ['request-email'],
        focusId: 'request-email',
      };
      setValidationError(issue);
      document.getElementById(issue.focusId)?.focus();
      return;
    }
    const questionError = missingRequiredAnswer(config.formQuestions, answers);
    if (questionError) {
      setValidationError(questionError);
      document.getElementById(questionError.focusId)?.focus();
      return;
    }

    setValidationError(undefined);
    flow.setGuest(cleanGuest);
    flow.setApplicationAnswers({ ...answers });
    flow.setSetupIntentId(undefined);
    flow.setRequestAcknowledgement(undefined);
    const idempotencyKey = flow.ensureRequestIdempotencyKey();

    if (config.paymentMethodCollection !== 'disabled') {
      navigate('/request/payment');
      return;
    }

    void flow
      .submitRequest(
        requestPayload({
        idempotencyKey,
        criteria: flow.criteria!,
        roomType: flow.roomType!,
        rate: flow.rate!,
        guest: cleanGuest,
        serviceIds: flow.serviceIds,
        applicationAnswers: answers,
        }),
      )
      .catch(() => undefined);
  };

  const isSubmitting = flow.requestSubmissionStatus === 'pending';
  const invalidIds = new Set(validationError?.invalidIds);
  const fieldErrorProps = (id: string) => ({
    'aria-invalid': invalidIds.has(id) || undefined,
    'aria-describedby': invalidIds.has(id)
      ? APPLICATION_ERROR_ID
      : undefined,
  });

  return (
    <RequestFlowFrame active={2}>
      <Button
        variant="ghost"
        onClick={() => navigate('/extras')}
        disabled={isSubmitting}
      >
        ← Back to extras
      </Button>
      <div className="mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">
          Step 2 of 3 · Your details
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[#183153]">
          Tell us about your stay
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#667085]">
          Share your contact details and anything the hotel should review with your
          request.
        </p>
      </div>

      <form
        aria-label="Booking request application"
        onSubmit={submit}
        noValidate
        className="mt-5 space-y-5 rounded-brand border border-[#D0D5DD] bg-white p-5 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="request-first-name" required>
            <input
              id="request-first-name"
              autoComplete="given-name"
              className={inputClass}
              value={firstName}
              disabled={isSubmitting}
              required
              aria-required="true"
              {...fieldErrorProps('request-first-name')}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </Field>
          <Field label="Last name" htmlFor="request-last-name" required>
            <input
              id="request-last-name"
              autoComplete="family-name"
              className={inputClass}
              value={lastName}
              disabled={isSubmitting}
              required
              aria-required="true"
              {...fieldErrorProps('request-last-name')}
              onChange={(event) => setLastName(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Email" htmlFor="request-email" required>
          <input
            id="request-email"
            type="email"
            autoComplete="email"
            className={inputClass}
            value={email}
            disabled={isSubmitting}
            required
            aria-required="true"
            {...fieldErrorProps('request-email')}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Phone" htmlFor="request-phone">
          <input
            id="request-phone"
            type="tel"
            autoComplete="tel"
            className={inputClass}
            value={phone}
            disabled={isSubmitting}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>

        {config.formQuestions.length > 0 && (
          <div className="space-y-5 border-t border-[#EAECF0] pt-5">
            <h2 className="text-base font-semibold text-[#183153]">Stay questions</h2>
            {config.formQuestions.map((question) => (
              <ConfiguredQuestion
                key={question.id}
                question={question}
                value={answers[question.id]}
                disabled={isSubmitting}
                invalid={invalidIds.has(question.id)}
                errorId={APPLICATION_ERROR_ID}
                onChange={(value) => setAnswer(question.id, value)}
              />
            ))}
          </div>
        )}

        <Field label="Special requests" htmlFor="request-special-requests">
          <textarea
            id="request-special-requests"
            rows={3}
            className={inputClass}
            value={specialRequests}
            disabled={isSubmitting}
            onChange={(event) => setSpecialRequests(event.target.value)}
          />
        </Field>

        {(validationError || flow.requestSubmissionStatus === 'error') && (
          <p
            id={APPLICATION_ERROR_ID}
            role="alert"
            className="rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {validationError?.message ?? errorMessage(flow.requestSubmissionError)}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting
            ? 'Submitting request…'
            : config.paymentMethodCollection === 'disabled'
              ? 'Submit booking request'
              : 'Continue to payment details'}
        </Button>
        <p className="text-center text-xs leading-5 text-[#667085]">
          Sending this form requests a review. It does not confirm a reservation.
        </p>
      </form>
    </RequestFlowFrame>
  );
}
