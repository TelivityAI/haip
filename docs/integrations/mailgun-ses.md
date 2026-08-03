# Mailgun & Amazon SES email

Transactional email adapters alongside SendGrid and SMTP.

## Mailgun

| Env | Required |
|-----|----------|
| `MAILGUN_API_KEY` | yes |
| `MAILGUN_DOMAIN` | yes |
| `MAILGUN_FROM` | optional (defaults to `noreply@MAILGUN_DOMAIN`) |
| `MAILGUN_API_BASE` | optional (default `https://api.mailgun.net`) |

Provider name: `mailgun`. Catalog slug: `mailgun`.

## Amazon SES (gateway)

Honest path — no forged AWS SigV4 in-process. Point at LocalStack, a signing sidecar, or a mock:

| Env | Required |
|-----|----------|
| `SES_ENDPOINT` | yes (gateway base URL) |
| `SES_API_KEY` | yes (Bearer token for the gateway) |
| `SES_FROM` | yes |
| `SES_REGION` / `AWS_REGION` | optional |

Provider name: `amazon-ses`. Catalog slug: `amazon-ses`.

## Provider order

SendGrid → Mailgun → SES → SMTP → console (first configured wins).

## Demos

```bash
./integrations/demos/run.sh mailgun
./integrations/demos/run.sh amazon-ses
```
