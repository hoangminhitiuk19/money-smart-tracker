# Phase 1 Foundation and Security Design

## Context

The application’s domain tests, Prisma schema validation, and production build
currently pass, but the release baseline is not safe or reproducible. Next.js
14.2.35 has unresolved security advisories, NextAuth resolves to an affected
release, linting is interactive, CI is absent, environment variables are not
validated, and the rate limits required by product specification §5.4 do not
exist.

The user approved one exception to the product specification: replace the
Next.js 14 pin with Next.js 15.5.21 Maintenance LTS. The product remains on
NextAuth v4 and otherwise retains the specification’s architecture and scope.
Vercel Hobby is the initial deployment target for personal, non-commercial use,
with Neon PostgreSQL as the database.

## Goals

- Establish a supported runtime: Node.js 22, Next.js 15.5.21, React 19.2.8,
  and NextAuth 4.24.15.
- Make lint, type checking, tests, Prisma validation, dependency audit, and
  build repeatable locally and in GitHub Actions.
- Validate the exact environment variables `DATABASE_URL`,
  `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`; reject `AUTH_SECRET` and `AUTH_URL`.
- Add distributed rate limiting for login, registration, authenticated
  mutations, and CSV export without adding another managed service.
- Add a conservative HTTP security-header baseline and deployment guidance.

## Non-Goals

This phase does not change financial calculations, transaction validation,
credit-card behavior, dashboard/report features, or general UX. It does not
add a strict Content Security Policy, an upload endpoint, monitoring, Redis, or
commercial hosting. Later readiness phases remain separately planned and
approved.

## Runtime and Tooling Architecture

Dependencies are pinned to Next.js 15.5.21, NextAuth 4.24.15, React and
ReactDOM 19.2.8, matching React type packages, and a compatible
`eslint-config-next`. Node 22 is declared in `.nvmrc` and `package.json`.

The Next.js migration converts server `headers()`, page `params`, and page
`searchParams` consumers to asynchronous APIs. React form state moves from
deprecated `useFormState` to `useActionState` while preserving current action
signatures and UI behavior.

`npm run verify` becomes the local aggregate gate. GitHub Actions runs a clean
install, Prisma validation, lint, typecheck, tests, production dependency
audit, and build under Node 22. CI supplies non-secret syntactically valid
values for the three required environment variables; it does not run database
migrations.

## Environment and HTTP Security

A server-only environment module validates:

- `DATABASE_URL` is a PostgreSQL URL.
- `NEXTAUTH_SECRET` is at least 32 characters.
- `NEXTAUTH_URL` is an absolute HTTP(S) URL.
- `AUTH_SECRET` and `AUTH_URL` are absent.

Application code consumes validated values rather than reading the three
variables independently. Tests isolate and reset module loading so different
environment cases cannot leak across test cases.

Global responses receive `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive
`Permissions-Policy`. A strict CSP is deferred because it requires a separate
nonce and third-party compatibility design.

## Rate-Limit Architecture

Rate limits use PostgreSQL rather than process memory because Vercel functions
do not share durable memory. A `RateLimitBucket` Prisma model has a composite
primary key over scope, HMAC identifier, and window start, plus an expiry
index. Identifiers are HMAC-SHA256 digests produced with `NEXTAUTH_SECRET`;
raw emails, IP addresses, and user IDs are never stored in rate-limit rows.

The store consumes a bucket atomically with PostgreSQL
`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`. Fixed-window decisions
use an injected clock in tests. A newly created bucket triggers best-effort,
bounded deletion of at most 500 expired rows. Enforcement fails closed if the
counter query fails; cleanup failure does not reverse an already established
decision.

Policies:

| Scope | Limit |
| --- | --- |
| Login by IP | 20 per 15 minutes |
| Login by normalized email | 5 per 15 minutes |
| Registration by IP | 5 per hour |
| Registration by normalized email | 3 per hour |
| Authenticated mutations by user | 60 per minute |
| CSV export by user | 10 per minute |

Login and registration check the IP bucket before creating an email bucket.
Vercel’s forwarded IP header is used first, followed by `x-real-ip` and a
constant fallback bucket. Form wrappers do not consume a second token; limits
live in the underlying mutation action.

NextAuth credential denial returns `null`, preserving the generic
“Invalid email or password” response. Registration and server actions return
`Too many requests. Please try again shortly.` in their existing result shape.
CSV export returns HTTP 429 with the same generic message and `Retry-After`.
Business queries and writes do not run after denial.

## Integration Boundaries

The mutation guard applies to the create, update, delete, toggle, status, and
payment actions in categories, money sources, projects, goals, goal
contributions, transactions, renewals, and settings. It also applies to
registration, credential authorization, and CSV export. Read-only loaders and
NextAuth session, CSRF, and logout routes are not limited.

The database migration is created and tested against the disposable Neon
database. Production deployment uses `prisma migrate deploy`, never
`prisma db push`. Vercel Preview and Production must have separate configured
values for the three approved environment variables. The Neon pooled endpoint
is used for serverless application traffic, and Vercel’s function region is
configured through project settings only after the actual Neon region is
known.

## Testing and Verification

Behavioral tests cover environment acceptance/rejection, HMAC namespacing,
fixed-window boundaries, atomic counter results, retry timing, fail-closed
behavior, cleanup bounds, auth denial before bcrypt/database work, mutation
denial before business writes, and CSV 429 behavior. Configuration-only
changes are verified through the real lint, typecheck, audit, and build
commands rather than source-text assertions.

Each implementation task follows red-green-refactor where behavior changes.
Each task receives an independent specification and code-quality review. The
phase concludes with a whole-branch review and fresh execution of:

```bash
npm ci
npx prisma validate
npm run lint
npm run typecheck
npm run test:run
npm audit --omit=dev --audit-level=high
npm run build
git diff --check
```

The disposable Neon database then receives `prisma migrate deploy`. A Vercel
Preview smoke test covers registration, login, logout, session persistence,
protected-route behavior after logout, a representative database write/read,
CSV export, HTTP 429 behavior, and response security headers.

## Definition of Done

Phase 1 is complete when the approved scope is implemented with tests, all
local and CI gates pass on Node 22, no high or critical production dependency
finding remains, the migration succeeds on the test database, the Vercel
Preview smoke checklist passes, and no forbidden environment alias or raw
rate-limit identifier is present. Any unavailable external deployment check is
reported as unverified rather than silently treated as complete.
