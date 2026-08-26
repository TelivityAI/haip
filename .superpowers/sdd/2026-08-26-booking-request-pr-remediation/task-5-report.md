# Task 5 report — ledger currency boundary

## Files

- `apps/api/src/modules/booking-request/booking-request-money.ts`
- `apps/api/src/modules/booking-request/booking-request.service.ts`
- `apps/api/src/modules/booking-request/booking-request-pricing.ts`
- `apps/api/src/modules/booking-request/booking-request-payment.service.ts`
- `apps/api/src/modules/booking-request/booking-request-money.spec.ts`
- `apps/api/src/modules/booking-request/booking-request-submission.spec.ts`
- `apps/api/src/modules/booking-request/booking-request-decision.spec.ts`
- `apps/api/src/modules/booking-request/booking-request-payment.spec.ts`

## Design

`assertLedgerCurrencySupported(currencyCode)` normalizes the ISO code, obtains its minor-unit exponent from `Intl`, and rejects exponents above two with a `BadRequestException`. The authoritative submission quote is checked immediately after quote validation and before card resolution or the transaction. Acceptance pricing and all payment amount/installment paths reuse the helper, preventing a scale-three legacy request from being accepted, charged, refunded, or rounded into the `numeric(12,2)` ledger.

## RED

- The new money and submission tests initially failed because the helper did not exist and BHD submission persisted a request.
- The acceptance test initially failed because a legacy BHD request was accepted into a reservation and folio.

## GREEN

- `pnpm --filter @telivityhaip/api typecheck`
- `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-money.spec.ts src/modules/booking-request/booking-request-submission.spec.ts src/modules/booking-request/booking-request-decision.spec.ts src/modules/booking-request/booking-request-payment.spec.ts src/modules/payment/stripe-webhook.spec.ts`

Both commands pass; the focused test run reports 240 passing tests.

## Commit

`fix(booking-requests): validate ledger currency at submission`

## Concerns

None. Existing test fixtures intentionally log simulated post-commit delivery failures; these are expected assertions and did not fail the suite.
