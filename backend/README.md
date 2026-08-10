# Ground Work Labs Lead Intake Backend

This directory is deployed as the root of the `groundwork-labs-intake` Vercel project. It receives trial requests from the public GitHub Pages website, stores each lead in the connected Neon Postgres database, and sends transactional emails through Resend.

## Runtime configuration

The Vercel project must provide the following **server-side** environment variables. Never add their values to the public website or this repository.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string for lead records. |
| `RESEND_API_KEY` | Resend API key for internal and customer notifications. |

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/trial` | Validates a trial request, creates a lead with `New` status, saves attribution fields, emails support, and emails the prospect a confirmation. |
| `GET /api/health` | Non-sensitive deployment health response. |

The production sender is `trials@updates.thegroundworklabs.com`; `support@thegroundworklabs.com` receives the internal notification and is used as the reply-to address for customer confirmations.
