# Money Smart Tracker

Next.js 15 App Router project with React 19, TypeScript, Tailwind CSS, Prisma, NextAuth v4, React Hook Form, Zod, Recharts, bcryptjs, and Vitest.

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

Do not commit `.env` or any file containing real secret values.

## Vercel and Neon release runbook

Use Node.js 22 and a clean dependency install for every local or CI release
check:

```bash
npm ci
npm run verify
```

Configure only these environment variables in each environment:

| Environment | `DATABASE_URL` | `NEXTAUTH_SECRET` | `NEXTAUTH_URL` |
| --- | --- | --- | --- |
| Local | `postgresql://<local-user>:<local-password>@<local-endpoint>-pooler.<neon-host>/<local-database>?sslmode=require` | `<generated-local-secret-at-least-32-characters>` | `http://localhost:3000` |
| Vercel Preview | `postgresql://<preview-user>:<preview-password>@<preview-endpoint>-pooler.<neon-host>/<preview-database>?sslmode=require` | `<generated-preview-secret-at-least-32-characters>` | `https://<preview-deployment-or-branch-url>` |
| Vercel Production | `postgresql://<production-user>:<production-password>@<production-endpoint>-pooler.<neon-host>/<production-database>?sslmode=require` | `<generated-production-secret-at-least-32-characters>` | `https://<canonical-production-domain>` |

Keep local values in the uncommitted `.env` file. Configure Vercel values with
[Preview and Production environment targeting](https://vercel.com/docs/environment-variables).
Use separate Preview and Production databases, and generate a different
unpredictable secret of at least 32 characters for each environment. The values
above are placeholders, never real credentials or secrets.

For application traffic, use Neon’s pooled connection URL: its hostname includes
`-pooler`. See Neon’s [connection-pooling guidance](https://neon.com/docs/connect/connection-pooling).
Never commit database URLs or secret values.

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

## Phase 2 backend release evidence

The post-fix sequential Node.js 22 Task 16 gate at audited head
`5a28eb7a33f71d9a23cc925e0a2f84ace2fa2aee` completed at
`2026-07-31T01:40:27Z`. Schema validation, all four migrations, zero-warning
lint, typecheck, 444 unit/rendered tests, 103 PostgreSQL integration tests, the
production dependency audit with zero vulnerabilities, and the 19-page
production build all passed. Independent whole-branch review returned
`APPROVED_BACKEND_GATE`, so the Phase 2 backend release gate is closed.

See `docs/quality/phase-2-backend-audit-report.md` for exact command evidence
and deferred development-only advisories. Vercel Preview, browser/manual QA,
mobile QA, Preview security smoke tests, and Production deployment remain
pending and were not run as part of the backend gate.

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
