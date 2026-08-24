-- Freeze the operational tariff chosen during Booking Request acceptance.
-- Existing reservations remain NULL and continue using their canonical live
-- rate-plan/night-audit behavior.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS accepted_pricing_snapshot jsonb;

-- This branch has never been released, so there is no truthful way to
-- reconstruct an accepted operational tariff from a legacy grand total. Abort
-- on an intermediate local database instead of inventing room/tax/service
-- allocations or silently permitting a reservation that night audit can
-- reprice. Operators can remove the unreleased local rows and rerun.
DO $booking_request_accepted_snapshot_precondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM booking_requests br
    LEFT JOIN reservations r
      ON r.id = br.accepted_reservation_id
      AND r.property_id = br.property_id
    WHERE br.status = 'accepted'
      AND (
        br.accepted_reservation_id IS NULL
        OR r.id IS NULL
        OR r.accepted_pricing_snapshot IS NULL
        OR (
          jsonb_typeof(r.accepted_pricing_snapshot) = 'object'
          AND (r.accepted_pricing_snapshot ->> 'version') = '1'
          AND (r.accepted_pricing_snapshot ->> 'source') IN ('submitted', 'current', 'custom')
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'currencyCode') = 'string'
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'grandTotal') = 'string'
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'roomTotal') = 'string'
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'taxTotal') = 'string'
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'servicesTotal') = 'string'
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'servicesTaxTotal') = 'string'
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'nights') = 'array'
          AND jsonb_array_length(r.accepted_pricing_snapshot -> 'nights') > 0
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'services') = 'array'
          AND r.accepted_pricing_snapshot ? 'customReason'
          AND jsonb_typeof(r.accepted_pricing_snapshot -> 'customReason') IN ('null', 'string')
          AND (
            (r.accepted_pricing_snapshot ->> 'source') <> 'custom'
            OR jsonb_typeof(r.accepted_pricing_snapshot -> 'customReason') = 'string'
          )
        ) IS NOT TRUE
      )
  ) THEN
    RAISE EXCEPTION 'Cannot apply accepted pricing: an accepted Booking Request lacks a complete immutable reservation snapshot; no lossless backfill exists';
  END IF;
END
$booking_request_accepted_snapshot_precondition$;

-- Pending requests may still be accepted using their submitted offer. Reject
-- the intermediate pre-review snapshot shape (which lacked posting lines)
-- rather than later interpreting a total in a newly selected currency or
-- pricing services from the live catalog.
DO $booking_request_submitted_quote_precondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM booking_requests
    WHERE status = 'pending'
      AND (
        jsonb_typeof(submitted_quote_snapshot) = 'object'
        AND jsonb_typeof(submitted_quote_snapshot -> 'currencyCode') = 'string'
        AND submitted_quote_snapshot ->> 'currencyCode' = currency_code
        AND jsonb_typeof(submitted_quote_snapshot -> 'grandTotal') = 'string'
        AND jsonb_typeof(submitted_quote_snapshot -> 'roomTotal') = 'string'
        AND jsonb_typeof(submitted_quote_snapshot -> 'taxTotal') = 'string'
        AND jsonb_typeof(submitted_quote_snapshot -> 'servicesTotal') = 'string'
        AND jsonb_typeof(submitted_quote_snapshot -> 'servicesTaxTotal') = 'string'
        AND jsonb_typeof(submitted_quote_snapshot -> 'lineItems') = 'array'
        AND jsonb_array_length(submitted_quote_snapshot -> 'lineItems') > 0
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(submitted_quote_snapshot -> 'lineItems') = 'array'
                THEN submitted_quote_snapshot -> 'lineItems'
              ELSE '[]'::jsonb
            END
          ) AS night
          WHERE (
            jsonb_typeof(night -> 'date') = 'string'
            AND jsonb_typeof(night -> 'rate') = 'string'
            AND jsonb_typeof(night -> 'tax') = 'string'
          ) IS NOT TRUE
        )
        AND jsonb_typeof(submitted_quote_snapshot -> 'services') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(submitted_quote_snapshot -> 'services') = 'array'
                THEN submitted_quote_snapshot -> 'services'
              ELSE '[]'::jsonb
            END
          ) AS service
          WHERE (
            jsonb_typeof(service -> 'serviceId') = 'string'
            AND jsonb_typeof(service -> 'code') = 'string'
            AND jsonb_typeof(service -> 'name') = 'string'
            AND jsonb_typeof(service -> 'postingRule') = 'string'
            AND jsonb_typeof(service -> 'chargeType') = 'string'
            AND jsonb_typeof(service -> 'currencyCode') = 'string'
            AND service ->> 'currencyCode' = currency_code
            AND jsonb_typeof(service -> 'unitPrice') = 'string'
            AND jsonb_typeof(service -> 'quantity') = 'number'
            AND jsonb_typeof(service -> 'lineTotal') = 'string'
            AND jsonb_typeof(service -> 'taxTotal') = 'string'
            AND jsonb_typeof(service -> 'lineItems') = 'array'
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(service -> 'lineItems') = 'array'
                    THEN service -> 'lineItems'
                  ELSE '[]'::jsonb
                END
              ) AS service_line
              WHERE (
                jsonb_typeof(service_line -> 'date') = 'string'
                AND jsonb_typeof(service_line -> 'amount') = 'string'
                AND jsonb_typeof(service_line -> 'tax') = 'string'
              ) IS NOT TRUE
            )
          ) IS NOT TRUE
        )
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Cannot apply accepted pricing: a pending Booking Request has an incompatible submitted quote snapshot and no lossless backfill exists';
  END IF;
END
$booking_request_submitted_quote_precondition$;

-- Only system-generated accepted-pricing rows receive a namespaced source
-- key. Existing/manual charges remain NULL, so no legacy value can collide.
ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS source_key varchar(255);

CREATE UNIQUE INDEX IF NOT EXISTS charges_property_folio_source_key_unique
  ON charges (property_id, folio_id, source_key);
