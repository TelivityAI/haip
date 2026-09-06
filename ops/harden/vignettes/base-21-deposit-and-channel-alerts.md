# Base 21 — money and channel failures are visible at the desk

## Deposit authorization fails during check-in

1. Check in an assigned reservation using a test payment method that the gateway rejects.
2. Confirm that the guest still reaches `checked_in` under the default warn-and-continue policy.
3. Confirm that the API returns `depositAuth.status=failed` with the safe code
   `DEPOSIT_AUTHORIZATION_FAILED`.
4. Confirm that the dashboard shows an error toast and the notification bell contains a
   critical `deposit_authorization_failed` item for the same property and reservation.
5. Retry authorization from the folio or record the supervisor-approved override in the
   shift handover process. Never treat a successful check-in response as proof of a hold.

## Availability/rate sync fails

1. Make a test channel adapter return a failed ARI result.
2. Confirm that Channels records `lastSyncStatus=failed` and a truncated safe error.
3. Confirm that the notification bell contains one critical `channel_sync_failed` item
   for the correct property and connection.
4. Retry while the connection remains failed; no additional notification should be created.
5. Restore the adapter and run a successful sync; confirm a `channel.sync_completed`
   recovery event and reconcile OTA inventory before reopening sales.
