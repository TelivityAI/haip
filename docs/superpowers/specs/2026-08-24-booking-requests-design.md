# Request-first direct bookings — design

**Status:** Approved in design review  
**Issue:** https://github.com/TelivityAI/haip/issues/332  
**Date:** 2026-08-24

## Summary

HAIP will support an opt-in request-first direct-booking flow. A guest selects
a sellable stay, answers property-configured questions, optionally or
mandatorily saves a card through Stripe, and submits a Booking Request. Staff
can review the request, take or record partial payments, and accept or deny it.
Acceptance creates the reservation regardless of payment state.

Booking Requests are a separate aggregate from waitlist. They apply only to
currently sellable inventory; unavailable demand remains a waitlist concern.

The feature is delivered as an end-to-end workflow: persistence, public
submission, staff API, dashboard, booking widget, payment handling, email,
audit, and tests. Request mode stays disabled by default, preserving the
existing instant-booking behavior.

## Goals

- Let a property choose `instant` or `request` direct-booking mode.
- Keep submission non-deducting and reservation-free.
- Let staff accept or deny requests and create exactly one reservation on
  acceptance.
- Collect a reusable card securely without charging at submission.
- Support multiple staff-initiated partial payments.
- Support both gateway charges and externally collected payments.
- Keep acceptance and payment independent.
- Keep the original offer, later quotes, decisions, money, and amendments
  auditable.
- Reuse reservation, folio, payment, email, permission, webhook, and audit
  behavior already present in HAIP.

## Non-goals

- No automatic charges.
- No request expiration.
- No request submission when inventory is unavailable.
- No public request status page or public management token.
- No guest withdrawal, reservation cancellation, or stay modification.
- No payment-authentication recovery link. A card charge requiring additional
  guest authentication is recorded as failed.
- No changes to waitlist semantics.

## Maintainer decisions

The issue maintainers confirmed:

- `booking_requests` is separate from waitlist.
- Zero availability routes to waitlist, not request mode.
- `bookingMode: instant | request` belongs to `booking_engine_config`.
- Queue reads use `reservations.read`; decisions and payment operations use
  `reservations.write`; configuration uses `bookingengine.manage`.

The original RFC proposed public follow-up access. Product design subsequently
removed it. The issue must be updated before implementation so maintainers can
see that the end-to-end scope contains no public status token or guest page.

Maintainers also promised knowledge-base references for the option/request
lifecycle and quote-snapshot retention. Implementation must use those sources
when supplied. Until then, this feature does not add automated snapshot
deletion or invent a retention period.

## Aggregate and lifecycle

### Booking Request

A Booking Request has the public lifecycle:

```text
pending ──accept──> accepted
   │
   └──deny───────> denied
```

- Submission always creates `pending`.
- `accepted` and `denied` are terminal request decisions.
- Acceptance creates and links one reservation.
- Denial creates no reservation.
- Requests never expire.
- Payment status is not part of the decision state machine.
- Internal processing markers may support recovery, but must not introduce
  additional product-visible lifecycle states.

### Denial with money

A request with captured money cannot be denied silently. Staff must resolve
each positive movement by one of these explicit actions:

- refund a gateway payment;
- record that an external payment was returned;
- retain the money with a mandatory reason.

The denial action remains unavailable until every captured amount has a
resolution. Refunds and retained amounts remain in the financial and audit
history.

## Persistence

### `booking_requests`

The aggregate stores:

- `id`, `propertyId`, and `status`;
- arrival, departure, occupancy, requested room type, and rate plan;
- guest name, email, phone, special requests, and structured application
  answers;
- immutable quote snapshot, including currency, line items, taxes, services,
  policies, and total shown at submission;
- snapshot of the form questions displayed at submission;
- card-collection result: Stripe customer and payment-method references,
  brand, last four, consent text/version, consent timestamp, and collection
  status; never raw card data;
- authoritative quote captured during acceptance;
- accepted price source: `submitted | current | custom`;
- accepted total, custom-price reason, decision actor, and decision timestamps;
- linked reservation and folio after acceptance;
- denial reason and retained-payment rationale where applicable;
- creation and update timestamps.

All reads and writes are scoped by both entity ID and caller-supplied
`propertyId`.

### Configurable questions

Question definitions live in Booking Engine Settings at property scope. The
supported types are:

- short text;
- long text;
- single select;
- multiple select;
- yes/no;
- date.

Each definition has a stable ID, label, type, ordered options where applicable,
display order, active state, and required state. Submission validates answers
against the current active definition. The request stores the displayed
definition and answers as an immutable snapshot, so later configuration changes
do not rewrite old applications.

### Payment plan

`booking_request_installments` stores staff-managed expected payments. An
installment contains:

- property and request scope;
- label and display order;
- either a fixed amount or percentage;
- resolved amount where a percentage has been applied;
- due milestone: explicit date, arrival, checkout, or manual;
- amount allocated from captured movements;
- status derived from allocation, such as unpaid, partial, or paid.

Installments are planning records. Reaching a date or milestone never initiates
a charge. Staff can add, edit, reorder, or remove only the unallocated portion.
Several movements can satisfy one installment, and one movement may be
allocated across installments when needed.

### Payment movements

The existing `payments` ledger is extended with request provenance. Before
acceptance, a payment targets the Booking Request. After acceptance, the same
row is also linked to the reservation folio without duplication while retaining
its request provenance.

The ledger must distinguish:

- Stripe charge attempts and results;
- externally collected payments with method, date, provider/reference, and
  notes;
- full and partial refunds;
- recorded external returns;
- retained amounts with reason;
- installment allocations.

The persistence layer enforces a valid financial target: folio, house account,
or Booking Request. Existing house-account and folio behavior remains
backward-compatible.

## Booking Engine Settings

`booking_engine_config` gains:

- `bookingMode: instant | request`, default `instant`;
- `paymentMethodCollection: required | optional | disabled`, default
  `disabled` for backward-compatible migration;
- property-scoped form-question definitions.

The existing `autoConfirm` field keeps its current instant-booking meaning and
does not control Booking Request acceptance.

The public configuration response exposes only the information needed to
render the widget: booking mode, card-collection policy, form schema, branding,
and existing sellable inventory configuration. It never exposes gateway secret
credentials.

## Public widget

Request mode uses a guided three-step flow:

1. **Stay:** dates, occupancy, room type, and rate plan.
2. **Application:** core guest details plus active configurable questions.
3. **Payment details:** Stripe Payment Element, skipped when disabled and
   explicitly skippable when optional.

The payment step states clearly that submission saves a payment method but
does not charge or confirm a reservation. Consent is explicit and versioned.

### Card-collection policies

- `required`: successful SetupIntent confirmation and consent are required
  before submission.
- `optional`: the guest explicitly chooses to add a card or continue without
  one.
- `disabled`: Stripe is not loaded and the flow proceeds from application to
  final confirmation.

### Submission

Submission uses a dedicated public request endpoint protected by the existing
publishable booking key. It cannot enumerate requests.

The server:

1. validates property mode and input;
2. validates the application against the current form schema;
3. enforces the card-collection policy;
4. rechecks sellability and availability;
5. computes the authoritative submission quote;
6. stores the request and immutable snapshots;
7. queues the receipt email;
8. returns an acknowledgement identifier and message.

The identifier is not a bearer credential and cannot be used to read or modify
the request.

## Staff interface

### API

Staff endpoints provide:

- paginated request queue filtered by property, state, stay dates, guest, and
  card presence;
- property-scoped request detail;
- acceptance and denial;
- installment creation, editing, ordering, and deletion;
- explicit Stripe charge with positive amount and idempotency key;
- external payment recording with positive amount, method, processed date,
  and reference;
- partial or full refund;
- external-return recording;
- retained-payment resolution with mandatory reason;
- email delivery history and manual retry.

There are no public read, update, withdrawal, or cancellation endpoints.

### Dashboard

The dashboard adds **Booking Requests** under Front Desk.

The queue shows status, stay dates, guest, requested total, and card presence.
Each request opens a dedicated detail page with persistent Accept and Deny
actions and these tabs:

- **Overview:** stay, application, quote comparison, card summary, and decision.
- **Payments & plan:** totals, installments, movements, refunds, and payment
  actions.
- **Messages:** receipt, acceptance, denial, payment, refund, and failure email
  deliveries with retry.
- **Audit:** immutable business-action history.

The acceptance modal compares submitted and current quotes and lets staff
choose submitted, current, or custom total. A custom total requires a reason.

The denial action is disabled until captured money has an explicit resolution.

## Acceptance

Acceptance and payment are independent. Staff may charge before or after the
decision, and a request can be accepted with no payment.

Acceptance:

1. acquires exclusive processing ownership for the pending request;
2. rechecks property scope, current availability, and rate-plan sellability;
3. produces a current authoritative quote;
4. validates the selected submitted, current, or custom total;
5. creates the guest, reservation, booking, folio, and ancillary links through
   existing canonical behavior;
6. links existing request payments to the folio without duplicating them;
7. records the decision and final price;
8. queues the acceptance email and emits audit/webhook events.

A unique request-to-reservation relationship makes retry safe. If a crash
occurs after reservation creation, the next attempt recovers and returns that
reservation rather than creating another. Accepting an already accepted
request returns the linked reservation. Lack of availability leaves the
request pending and changes no business state.

## Payments

### Stripe charge

The dashboard charge action requires a positive amount and explicit staff
confirmation. HAIP writes a pending attempt before calling Stripe and uses a
stable idempotency key. It then records captured or failed status.

No charge is automatic. A charge requiring additional guest authentication is
recorded as failed; HAIP does not send a recovery link.

### External payment

Staff can record cash, bank transfer, offline terminal, or another supported
method. The record includes amount, currency, processed time, method,
reference, and notes. A unique external reference or client idempotency key
prevents duplicate submission.

### Partial payments

Several movements can be taken at any time and allocated to installments.
Examples include 30% before arrival and 70% at arrival or checkout. Milestones
are informational; staff always initiates the movement.

An amount of zero or less is rejected. Refund totals cannot exceed the net
captured amount.

## After acceptance: folio and stay changes

The Booking Request remains immutable evidence of the submitted and accepted
deal. The reservation and folio become the active operational and financial
records.

The request detail continues to show the linked folio:

- accepted accommodation price;
- subsequent folio charges such as restaurant, minibar, spa, or other extras;
- captured and returned amounts;
- current balance due.

Staff may update the payment plan or take any partial amount against the
current balance. No automatic reconciliation initiates money movement.

### Stay extension or amendment

From an accepted request, `Modify stay` delegates to the linked reservation.
For a date extension, HAIP:

1. checks availability for the amended complete stay;
2. recalculates the authoritative stay quote;
3. compares the prior accepted price with the current quote;
4. lets staff choose the prior-rate basis, current quote, or a custom total;
5. requires a reason for custom pricing;
6. updates the reservation only if availability remains valid;
7. leaves the original request and Accepted Price unchanged;
8. records prior/new dates, prices, reason, and actor;
9. exposes the revised reservation and folio balance in Payments & plan.

Existing folio charges continue to determine the operational balance. The
amendment must not double-post room revenue already handled by existing folio
or night-audit behavior.

## Email

Automatic transactional emails cover:

- request received;
- request accepted;
- request denied;
- payment captured or externally recorded;
- refund or external return recorded;
- payment failed.

Delivery has its own `pending | sent | failed` record. Email is a consequence,
not part of the transaction that changes the request or moves money. Failure
does not roll back a decision or payment. Staff can retry a failed delivery.

Emails contain no private request-management link and no payment-authentication
link.

## Permissions and tenant isolation

- Queue and detail: `reservations.read`.
- Accept, deny, installments, payment, refund, and email retry:
  `reservations.write`.
- Booking mode, card policy, and form configuration:
  `bookingengine.manage`.

Every request, installment, payment, delivery, and mutation carries and filters
by caller-supplied `propertyId`. Request IDs, payment IDs, reservation IDs, and
form-definition IDs are never used alone for a property-scoped operation.

Public submission derives property scope only from the validated publishable
booking credential, consistent with existing booking-engine endpoints.

## Audit and webhooks

Audit entries cover submission, decision attempts and results, quote choice,
custom pricing, installment changes, payment attempts/results, external
payments, refunds, retained money, email delivery, and stay amendments.

Webhook events follow the existing `entity.action` convention. At minimum the
design needs request created/accepted/denied, payment received/failed/refunded,
and reservation modified events. Payloads include property scope and stable
entity identifiers but exclude application answers, consent text, and payment
tokens unless an existing security-reviewed event contract explicitly permits
them.

## Consistency and recovery

- Request acceptance is concurrency-safe and produces at most one reservation.
- Payment attempts are persisted before external gateway calls.
- Gateway calls occur outside database transactions and use stable idempotency
  keys.
- Retries return or complete prior work instead of repeating side effects.
- External payment recording is idempotent.
- Property scope is checked before any external side effect.
- Email and webhook failures are recorded and retryable without rolling back
  committed business state.
- No database transaction remains open while waiting on an external provider.

## Error behavior

- Unavailable stay at submission or acceptance: conflict; no request/reservation
  mutation for acceptance, and no request created at submission.
- Invalid or inactive offer: validation failure with no mutation.
- Required card missing or setup incomplete: submission rejected.
- Duplicate acceptance: return the linked reservation.
- Duplicate charge idempotency key: return the previous attempt/result.
- Additional card authentication required: failed payment, no link generated.
- Denial with unresolved money: conflict listing the movements to resolve.
- Email failure: business action succeeds and delivery shows failed/retryable.
- Cross-property identifier: not found under the caller's property scope.

## Test strategy

### Domain and persistence

- migration defaults and rollback-safe forward schema;
- request state transitions and terminal-state behavior;
- immutable quote and form snapshots;
- installment calculation and allocation;
- financial target and refund constraints;
- request-to-reservation uniqueness.

### API and security

- booking mode and card policy combinations;
- public submission cannot enumerate or retrieve requests;
- property isolation on every route and nested resource;
- confirmed permissions for reads, decisions, configuration, and payments;
- configurable-question validation and historical snapshots;
- no raw card data stored or logged.

### Concurrency and failure

- simultaneous acceptance creates one reservation;
- simultaneous/retried charge creates one gateway operation;
- partial and repeated refunds cannot exceed net captured amount;
- failure after external success can be reconciled on retry/webhook;
- email and webhook failure do not roll back business state.

### Product flow

- instant mode remains unchanged;
- request widget steps and required/optional/disabled card modes;
- queue and detail tabs;
- accept with submitted/current/custom price;
- deny with no money and with each money-resolution path;
- multiple partial gateway and external payments;
- linked folio balance after additional hotel charges;
- stay extension with availability, repricing, audit, and no duplicate revenue;
- transactional email creation and retry.

### End-to-end

At least one end-to-end scenario covers:

1. configure request mode and custom questions;
2. submit with a saved card;
3. create a 30/70 payment plan;
4. take a partial gateway payment;
5. accept with a recalculated price;
6. add an external payment;
7. add a folio extra;
8. extend the stay;
9. inspect the resulting reservation, folio, audit, and messages.

## Rollout and compatibility

- Existing properties migrate to `bookingMode=instant` and
  `paymentMethodCollection=disabled`.
- Instant booking endpoints and widget responses remain compatible.
- Request-only routes and UI remain unreachable unless request mode is enabled.
- Configuration can return from request to instant mode without deleting
  existing requests; staff retains access to their history.
- Deployment must not expose request mode until schema, API, dashboard, widget,
  payment, and email pieces are all present.

## Delivery scope

The product slice is complete only when the end-to-end workflow above is
usable. Implementation may use reviewable commits or stacked pull requests,
but partial infrastructure must remain disabled and backward-compatible until
the complete feature lands.
