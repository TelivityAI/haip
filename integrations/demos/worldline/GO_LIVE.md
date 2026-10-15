# Go live

1. Create a test API key and secret for the property PSPID in the merchant portal.
2. Set on the API process, then restart:

```
PAYMENT_GATEWAY=worldline
WORLDLINE_MERCHANT_ID=...
WORLDLINE_API_KEY_ID=...
WORLDLINE_SECRET_API_KEY=...
WORLDLINE_ENV=test
WORLDLINE_WEBHOOK_KEY_ID=...
WORLDLINE_WEBHOOK_SECRET=...
PUBLIC_API_BASE_URL=https://api.example
BOOKING_RETURN_ORIGINS=https://hotel.example
```

3. Or save the same merchant fields on the property Integrations row. The API secret and webhook secret are encrypted.
4. Point webhooks at `https://api.example/api/v1/webhooks/worldline`.
5. Switch `WORLDLINE_ENV=live` and the live key pair only after a test in-page authorization, capture, cancel, and refund succeed. Live keys are different from test keys.
