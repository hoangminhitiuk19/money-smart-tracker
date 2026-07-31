# Repository Guidelines

## Sources of Truth

Read `money-quality-tracker-spec-v4.md` and the relevant section of
`codex-prompting-guide-v2.md` before every phase. The product specification
controls behavior and validation; the prompting guide controls phase order and
workflow. If they appear to conflict, stop and discuss the discrepancy. Treat
existing code and claims in `CLAUDE.md` as useful context, not proof that a
phase is complete.

## Architecture

- `app/`: Next.js 15 App Router pages. Public authentication routes live in
  `app/(auth)`; authenticated pages live in `app/(protected)` and must use
  `requireAuth()`. API routes live in `app/api`.
- `components/`: domain forms and reusable UI. Prefer primitives in
  `components/ui/` over duplicating established patterns.
- `lib/actions/`: server actions and database orchestration. Authentication,
  ownership checks, Zod validation, and mutation-side activity logging belong
  here.
- `lib/calc/`: pure financial calculations. These functions must not access
  Prisma or other external state.
- `prisma/`: PostgreSQL schema and migrations. Use migrations for schema
  changes; production uses `prisma migrate deploy`, never `db push`.
- `tests/`: Vitest suites named `*.test.ts`, using mock data for pure logic and
  focused mocks for server-action boundaries.

## Phase Workflow

Work on exactly one phase (or named dashboard/report sub-phase) at a time:

1. Re-read and cite the applicable specification sections.
2. Compare that phase with the current implementation; do not assume it is
   complete.
3. Discuss a bounded plan, files, tests, risks, and acceptance criteria. Wait
   for approval before implementing.
4. Add or update tests alongside the smallest feature change. Avoid unrelated
   refactors and never expand scope without approval.
5. End with verification and a concise list of changes, passing checks, manual
   QA performed, and unresolved issues.

Preserve the guide’s dependency order: Phase 0 setup and baseline; 1 schema; 2
authentication; 3 categories; 4 accounts; 5 projects; 6 transactions; 7 credit
cards; 8 goals; 9 renewals; 10 dashboard (five sub-phases); 11 reports (three
sub-phases); 12 search/export; 13 activity log; 14 core tests; 15 final security,
mobile, loading, empty-state, receipt, and settings checks.

## Security and Domain Constraints

- Use only `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`. Never use
  `AUTH_SECRET` or `AUTH_URL`, and never commit real secrets.
- Obtain `userId` from `requireAuth()` only. Scope every private query by it,
  verify ownership before reads or mutations, and ownership-check every
  referenced foreign key.
- Never store full card numbers, CVV/CVC, PIN, OTP, or banking credentials.
- Use `fromMoneySourceId` and `toMoneySourceId`; never replace the directional
  model with a single `moneySourceId`.
- Amounts are positive. Transaction type and `adjustmentDirection` encode
  direction. Enforce the exact INCOME, EXPENSE, TRANSFER, REFUND, and ADJUSTMENT
  field matrix from specification §6.4.
- UI end dates are inclusive; database ranges must exclude the start of the
  following day.
- Apply card-credit priority, payment overflow, refund, fee-waiver, goal,
  project, balance, and raw-versus-effective-expense rules exactly as specified.
- Write `ActivityLog` entries server-side within the mutation transaction or
  action. Clearly label all tracked or estimated financial values.

## Commands and Validation

After `npm ci` and local environment setup:

```bash
npm run dev
npm run lint
npm run test:run
npm run test:integration
npm run build
npx prisma validate
npm run prisma:migrate
```

Run targeted Vitest files during development, then the full suite. A schema
phase must validate its migration. Security-sensitive phases require explicit
cross-user isolation checks. Final release validation includes the specification
manual QA checklist and `prisma migrate deploy` against a production-like
database.

## Definition of Done

A phase is done only when its approved scope matches the cited specification,
tests were added with the change and pass, lint/build pass, required migrations
and manual checks succeed, ownership and safe-error behavior are verified, and
documentation is updated. Report blockers honestly; skipped or unavailable
checks mean the phase remains unverified.
