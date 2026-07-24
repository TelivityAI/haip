# Bird (MessageBird) SMS

[Bird](https://bird.com/) (formerly MessageBird) SMS as an alternative to Twilio for guest SMS notifications.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `BIRD_ACCESS_KEY` | Yes | Bird/MessageBird REST access key |
| `BIRD_ORIGINATOR` | Yes | Sender name or number allowed on your Bird account |

Legacy aliases: `MESSAGEBIRD_ACCESS_KEY`, `MESSAGEBIRD_ORIGINATOR`.

## Provider order

`NotificationService` tries providers in order: **Twilio → Bird → console**. The first configured non-console provider sends the message.

## Send a test SMS

```http
POST /api/v1/notifications/sms
Authorization: Bearer <staff JWT>
Content-Type: application/json

{
  "propertyId": "<uuid>",
  "to": "+15551234567",
  "body": "Your room is ready."
}
```

Without credentials, the console provider logs the message and returns `sent: false`.

See also: [Integration catalog](../INTEGRATIONS.md) — **Bird**.
