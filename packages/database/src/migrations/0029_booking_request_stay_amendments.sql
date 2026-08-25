-- Durable, property-scoped idempotency and immutable operational snapshots for
-- staff stay amendments. The original Booking Request deal is never updated.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_property_id_unique
  ON reservations(property_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS folios_property_id_unique
  ON folios(property_id, id);

CREATE TABLE IF NOT EXISTS booking_request_stay_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  booking_request_id uuid NOT NULL REFERENCES booking_requests(id),
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  folio_id uuid NOT NULL REFERENCES folios(id),
  idempotency_key varchar(200) NOT NULL,
  operation_fingerprint varchar(64) NOT NULL,
  preview_token varchar(67) NOT NULL,
  price_source varchar(10) NOT NULL CHECK (price_source IN ('prior', 'current', 'custom')),
  previous_arrival_date date NOT NULL,
  previous_departure_date date NOT NULL,
  new_arrival_date date NOT NULL,
  new_departure_date date NOT NULL,
  previous_total_amount numeric(12,2) NOT NULL,
  new_total_amount numeric(12,2) NOT NULL,
  currency_code varchar(3) NOT NULL,
  reason text,
  previous_pricing_snapshot jsonb NOT NULL,
  new_pricing_snapshot jsonb NOT NULL,
  actor_user_id uuid,
  actor_email varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_request_stay_amendments_dates_check
    CHECK (new_departure_date > new_arrival_date),
  CONSTRAINT booking_request_stay_amendments_total_check
    CHECK (new_total_amount > 0),
  CONSTRAINT booking_request_stay_amendments_custom_reason_check
    CHECK (price_source <> 'custom' OR (reason IS NOT NULL AND length(trim(reason)) > 0)),
  CONSTRAINT booking_request_stay_amendments_request_fkey
    FOREIGN KEY (property_id, booking_request_id)
    REFERENCES booking_requests(property_id, id),
  CONSTRAINT booking_request_stay_amendments_reservation_fkey
    FOREIGN KEY (property_id, reservation_id)
    REFERENCES reservations(property_id, id),
  CONSTRAINT booking_request_stay_amendments_folio_fkey
    FOREIGN KEY (property_id, folio_id)
    REFERENCES folios(property_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_request_stay_amendments_property_idempotency_unique
  ON booking_request_stay_amendments(property_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS br_stay_amendments_property_request_fingerprint_unique
  ON booking_request_stay_amendments(property_id, booking_request_id, operation_fingerprint);

-- Give canonical accepted room groups the same durable identity used by future
-- night-audit posting. Match the immutable night, amount, and canonical
-- description, and claim at most one base per reservation/date so manual room
-- charges and ambiguous legacy duplicates remain NULL.
WITH accepted_room_candidates AS (
  SELECT
    c.id,
    f.property_id,
    f.id AS folio_id,
    f.reservation_id,
    night->>'date' AS stay_date,
    row_number() OVER (
      PARTITION BY f.property_id, f.reservation_id, night->>'date'
      ORDER BY c.id
    ) AS candidate_rank
  FROM folios f
  JOIN reservations r
    ON r.id = f.reservation_id
    AND r.property_id = f.property_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(r.accepted_pricing_snapshot->'nights') = 'array'
        THEN r.accepted_pricing_snapshot->'nights'
      ELSE '[]'::jsonb
    END
  ) AS night
  JOIN charges c
    ON c.folio_id = f.id
    AND c.property_id = f.property_id
    AND c.type = 'room'
    AND c.is_reversal = false
    AND c.parent_charge_id IS NULL
    AND c.source_key IS NULL
    AND to_char(c.service_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') = night->>'date'
    AND c.amount::numeric = (night->>'roomAmount')::numeric
    AND c.description = 'Room tariff - ' || (night->>'date')
), unclaimed_accepted_room_candidates AS (
  SELECT candidate.*
  FROM accepted_room_candidates candidate
  WHERE candidate.candidate_rank = 1
    AND NOT EXISTS (
      SELECT 1
      FROM charges claimed
      WHERE claimed.property_id = candidate.property_id
        AND claimed.folio_id = candidate.folio_id
        AND claimed.source_key = 'accepted-pricing:reservation:'
          || candidate.reservation_id::text || ':night:' || candidate.stay_date
    )
)
UPDATE charges c
SET source_key = 'accepted-pricing:reservation:' || candidate.reservation_id::text
  || ':night:' || candidate.stay_date
FROM unclaimed_accepted_room_candidates candidate
WHERE c.id = candidate.id;
