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

Do not commit `.env` or any file containing real secret values.

## Vercel and Neon release runbook

Use Node.js 22 and a clean dependency install for every local or CI release
check:

```bash
npm ci
npm run verify
```

Configure only these environment variables in each environment:

<!-- markdownlint-disable MD013 -->

| Environment | `DATABASE_URL` | `NEXTAUTH_SECRET` | `NEXTAUTH_URL` |
| --- | --- | --- | --- |
| Local | `postgresql://<local-user>:<local-password>@<local-endpoint>-pooler.<neon-host>/<local-database>?sslmode=require` | `<generated-local-secret-at-least-32-characters>` | `http://localhost:3000` |
| Vercel Preview | `postgresql://<preview-user>:<preview-password>@<preview-endpoint>-pooler.<neon-host>/<preview-database>?sslmode=require` | `<generated-preview-secret-at-least-32-characters>` | `https://<preview-deployment-or-branch-url>` |
| Vercel Production | `postgresql://<production-user>:<production-password>@<production-endpoint>-pooler.<neon-host>/<production-database>?sslmode=require` | `<generated-production-secret-at-least-32-characters>` | `https://<canonical-production-domain>` |

<!-- markdownlint-enable MD013 -->

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
