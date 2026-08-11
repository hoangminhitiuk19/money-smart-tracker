# Money Smart Tracker

Next.js 15 App Router project with React 19, TypeScript, Tailwind CSS, Prisma,
NextAuth v4, React Hook Form, Zod, Recharts, bcryptjs, and Vitest.

## Prerequisites

- Node.js 22

## Environment

Copy the example environment file before running the app:

```bash
cp .env.example .env
```

Fill in the values for:

```bash
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

The optional inbound templates in `.env.example` are commented, so copying
`.env.example` leaves inbound-email testing disabled. To enable it, uncomment
all three entries and configure them together:

```bash
# INBOUND_EMAIL_API_KEY=
# INBOUND_EMAIL_WEBHOOK_SECRET=
# INBOUND_EMAIL_DOMAIN=
```

Do not commit `.env` or any file containing real secret values.

## Vercel and Neon release runbook

Use Node.js 22 and a clean dependency install for every local or CI release
check:

```bash
npm ci
npm run verify
```

Configure these foundational environment variables in each environment. The
optional inbound-email testing group is described below and is not authorized
for Production.

<!-- markdownlint-disable MD013 -->

| Environment | `DATABASE_URL` | `NEXTAUTH_SECRET` | `NEXTAUTH_URL` | Inbound-email testing group |
| --- | --- | --- | --- | --- |
| Local | `postgresql://<local-user>:<local-password>@<local-endpoint>-pooler.<neon-host>/<local-database>?sslmode=require` | `<generated-local-secret-at-least-32-characters>` | `http://localhost:3000` | Optional complete testing-only group |
| Vercel Preview | `postgresql://<preview-user>:<preview-password>@<preview-endpoint>-pooler.<neon-host>/<preview-database>?sslmode=require` | `<generated-preview-secret-at-least-32-characters>` | `https://<preview-deployment-or-branch-url>` | Optional complete testing-only group |
| Vercel Production | `postgresql://<production-user>:<production-password>@<production-endpoint>-pooler.<neon-host>/<production-database>?sslmode=require` | `<generated-production-secret-at-least-32-characters>` | `https://<canonical-production-domain>` | Not authorized |

<!-- markdownlint-enable MD013 -->

Keep local values in the uncommitted `.env` file. Configure Vercel values with
[Preview and Production environment targeting](https://vercel.com/docs/environment-variables).
Use separate Preview and Production databases, and generate a different
unpredictable secret of at least 32 characters for each environment. The values
above are placeholders, never real credentials or secrets.

For application traffic, use Neon’s pooled connection URL: its hostname includes
`-pooler`. See Neon’s [connection-pooling guidance](https://neon.com/docs/connect/connection-pooling).
Never commit database URLs or secret values.

## Free inbound-email testing

The secure inbound-email foundation is available at
`/transactions/capture/email` for Local and Vercel Preview testing. It accepts
only the exact synthetic fixture below and creates a reviewable `EMAIL` draft;
receiving email never creates a transaction or changes any financial total.

The inbound-email group is optional. Leave all three values absent for normal
local builds and automated tests. To test the live Resend boundary, uncomment
all three entries and configure them together:

```bash
# INBOUND_EMAIL_API_KEY=
# INBOUND_EMAIL_WEBHOOK_SECRET=
# INBOUND_EMAIL_DOMAIN=
```

Automated tests use mocked provider contracts and do not need a Resend account.
When the group is absent, the protected setup page shows a safe unavailable
state while disable, deletion, and disconnect privacy controls remain usable for
an existing mailbox.

### Owner runbook: free Resend and Vercel Preview

Use synthetic data and a separate testing database. Never paste credentials,
webhook signatures, generated addresses, or provider identifiers into chat,
git, screenshots, logs, or acceptance documents.

1. Create a free Resend account. On the **Emails** page, open the **Receiving**
   tab, use the three-dot menu, choose **Receiving address**, and copy the
   assigned `*.resend.app` receiving domain. See Resend's
   [Receiving introduction](https://resend.com/docs/dashboard/receiving/introduction).
2. Deploy this branch to Vercel Preview with the Preview `DATABASE_URL`,
   `NEXTAUTH_SECRET`, and exact Preview `NEXTAUTH_URL`. Do not reuse Production
   values.
3. In Resend, open the **API Keys** dashboard, choose **Create API Key**, enter
   a named testing key, and choose **Full access**. Received-email retrieval
   requires API access; **Sending access** is insufficient. Resend displays the
   key only once, so copy it directly to Vercel as
   `INBOUND_EMAIL_API_KEY` with the **Preview** target. See Resend's
   [API-key guidance](https://resend.com/docs/dashboard/api-keys/introduction).
4. Copy the complete HTTPS Preview deployment URL and append
   `/api/webhooks/inbound-email`. On Resend's **Webhooks** page choose **Add
   Webhook**, enter that complete endpoint, select only `email.received`, and
   choose **Add**. After creating the `email.received` webhook, open its details
   and copy the signing secret directly to Vercel as
   `INBOUND_EMAIL_WEBHOOK_SECRET` with the **Preview** target. See Resend's
   [webhook-signature guidance](https://resend.com/docs/webhooks/verify-webhooks-requests).
5. In Vercel **Project Settings → Environment Variables**, add the receiving
   domain as `INBOUND_EMAIL_DOMAIN` with the **Preview** target. Confirm all
   three inbound entries are configured for Preview. Environment changes apply
   only to a new deployment, so redeploy Preview. See Vercel's
   [environment-variable guidance](https://vercel.com/docs/environment-variables/managing-environment-variables).
6. Sign in to Preview, open `/transactions/capture/email`, create the private
   test address, and send exactly this fixture to it:

   ```text
   MONEY SMART TRACKER TEST
   Amount: 125000
   Currency: VND
   Date: 2026-08-10
   Merchant: Demo Cafe
   ```

7. Confirm one received status and one `NEEDS_REVIEW` email draft. Choose an
   owned source, import once, and confirm exactly one transaction appears.
8. Replay the same event from Resend and confirm it is reported as a duplicate
   without another draft or transaction.
9. Rotate the test address and confirm the old address no longer creates a
   draft. Exercise disable, enable, delete-pending-data, and disconnect.
10. Repeat the flow by keyboard on desktop and at 375px. Confirm visible focus,
   text/icon status labels, 44px targets, reduced-motion behavior, and no
   document overflow.

The application can receive only messages explicitly sent to the generated
address; it cannot browse a mailbox. Message text and HTML are processed only in
memory. Attachments are never requested. The database stores the random local
alias needed for repeat copying, hashes of provider event/message identifiers,
bounded status/disposition metadata, and lifecycle timestamps. It does not store
the raw webhook, body, HTML, subject, sender or forwarding address, complete
generated address, provider identifiers, headers, or attachments. Resend may
retain received email separately for up to 30 days; see Resend's
[retention guidance](https://resend.com/docs/dashboard/webhooks/how-to-store-webhooks-data).

Pending email drafts become cleanup-eligible after 30 days and receipt metadata
after 90 days. Preview cleanup is opportunistic, so these thresholds are not a
wall-clock deletion guarantee while the app is idle.

Gmail/Outlook onboarding, institution or bank parsers, real financial email,
custom domains, attachment handling, scheduled deletion with monitoring, and
Production use remain excluded. A separate Production security/privacy design
and approval are required before enabling this feature in Production.

Before deploying, run `npm run verify`. During the release, run migrations with:

```bash
npm run prisma:deploy
```

After the actual Neon region is known, select the matching Vercel Function
Region in project **Settings → Functions**; see Vercel’s [function-region
documentation](https://vercel.com/docs/functions/configuring-functions/region).
Vercel [Hobby](https://vercel.com/docs/plans/hobby) is for personal,
non-commercial use; choose an eligible plan before using it for other work.

After deployment, smoke test registration, login, logout, session persistence,
access to a protected route after logout, a representative write and read, CSV
export, a rate-limited CSV export returning 429, and the response headers.

## Capturing transactions

The Transactions page offers two complementary entry paths:

- **Capture transactions** (`/transactions/capture`) stages repeated entries as
  reviewable drafts. Quick add is suited to one fast entry; Paste rows accepts
  comma-separated CSV and tab-separated spreadsheet text copied from Excel or
  Google Sheets. Files and pasted input are limited to 200 rows and 1 MB.
- **Add transaction** (`/transactions/new`) remains available for the existing
  single-entry form and its full set of fields.

For pasted data, include headers when possible. The mapper detects common
columns for date, type, title, amount, accounts, category, quality, project,
description, adjustment data, and related transactions. Ambiguous columns must
be mapped explicitly, and malformed CSV/TSV remains in the input so it can be
corrected and reviewed again.

Captured rows are drafts: review every finding, correct type-specific fields,
select the rows to keep, and use fill-down for repeated values. Desktop ledger
cells support Tab and arrow-key navigation; narrow screens use editable cards.
Saving is atomic for the selected set, and retrying a failed request reuses its
idempotency key so the same batch is not created twice. Unselected drafts remain
available for later review.

Email forwarding testing is available at `/transactions/capture/email` as a
separate, review-first path. It uses the optional all-or-none environment group
documented above and remains excluded from Production.

## Phase 2 release evidence

The current Node.js 22 release baseline includes:

- zero-warning lint, typecheck, Prisma validation, and a passing production
  build;
- 44 files and 473 unit/rendered tests;
- 16 files and 105 PostgreSQL integration tests, including the
  poisoned-relation regressions;
- all four migrations applied with none pending;
- 199/199 traceability rows `Covered`, with no `Missing`, `Failing`, or
  `Ambiguous` rows; and
- a production dependency audit with 0 vulnerabilities.

The protected
[Vercel Preview](https://money-smart-tracker-preview-minhs-projects-f5a749c2.vercel.app)
passed browser, financial-edge, domain-edge, mobile, security, and
two-user-isolation acceptance. See the
[Phase 2 Preview acceptance report](docs/quality/phase-2-preview-acceptance.md)
for the complete evidence and remaining caveats. Production has not been
deployed and is not authorized by Phase 2.

The development-inclusive dependency audit still reports 7 maintenance
advisories in test and build tooling: 3 moderate, 3 high, and 1 critical. These
are tracked separately from the production audit in the
[backend audit report](docs/quality/phase-2-backend-audit-report.md).

## Prisma

Run migrations against your PostgreSQL database:

```bash
npm run prisma:migrate
```

This runs:

```bash
npx prisma migrate dev
```

## Development

Install dependencies:

```bash
npm ci
```

Run the dev server:

```bash
npm run dev
```

## Tests

Run the test suite:

```bash
npm run test:run
```
