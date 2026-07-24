# SendGrid transactional email

Use [SendGrid](https://sendgrid.com/) as HAIP’s email transport for guest confirmations, pre-arrival messages, and operational mail. HAIP picks **SendGrid before SMTP** when both are configured.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `SENDGRID_API_KEY` | Yes | SendGrid API key with Mail Send permission |
| `SENDGRID_FROM` | Yes | Verified sender address (e.g. `frontdesk@yourhotel.com`) |

SMTP variables (`SMTP_*`) remain supported as a fallback when SendGrid is not set.

## Behavior

- Guest-comms and reservation messaging call `EmailService`, which routes through the SendGrid adapter when configured.
- If neither SendGrid nor SMTP is configured, messages are **logged only** (console provider) — same as before for unset SMTP.

## Verify

1. Set `SENDGRID_API_KEY` and `SENDGRID_FROM` on the API container.
2. Trigger a guest email (e.g. compose from the dashboard or a reservation lifecycle event).
3. Check API logs for `Email sent via SendGrid to …`.

## Webhooks (optional)

SendGrid delivery events can be wired to HAIP webhooks in a later wave; this adapter covers outbound send only.

See also: [Integration catalog](../INTEGRATIONS.md) — **SendGrid**.
