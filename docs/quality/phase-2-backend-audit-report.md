# Phase 2 Backend Audit Report

## Status

The Task 16 backend gate is **closed and approved** at audited head
`5a28eb7a33f71d9a23cc925e0a2f84ace2fa2aee`. The post-fix sequential Node.js 22
gate completed at `2026-07-31T01:40:27Z`, and independent whole-branch review
returned `APPROVED_BACKEND_GATE`.

Vercel Preview deployment and the specification §29 manual, security, and
mobile QA checklist are **not complete**. No Preview or Production deployment
was run as part of this gate.

## Scope and release criteria

This gate follows the Phase 2 release-candidate audit plan Task 16, the
prompting guide Phase 14 and Phase 15 checks, and specification §§28–30. The
automated backend scope is specification §§6–22 and §28, including Decimal-safe
financial calculations, authenticated ownership, mutation atomicity,
cross-module reconciliation, migrations, dependency risk, and a production
build.

- Branch: `codex/phase-2-release-candidate-audit`
- Audited head: `5a28eb7a33f71d9a23cc925e0a2f84ace2fa2aee`
- Gate date: 2026-07-31 UTC
- Exact aggregate completion timestamp: `2026-07-31T01:40:27Z`
- Runtime: Node.js 22
- Database: authorized disposable PostgreSQL audit database; credentials and
  connection values are intentionally omitted

## Command evidence

Commands ran sequentially from a clean install on 2026-07-31 UTC. Exact
per-command timestamps were not captured; the exact aggregate completion
timestamp was `2026-07-31T01:40:27Z`.

| Sequential command | Exit | Evidence |
| --- | ---: | --- |
| `npx --yes --package=node@22 --call='npm ci'` | 0 | Installed 542 packages; the dev-inclusive audit reported 7 advisories |
| `npx --yes --package=node@22 --call='./node_modules/.bin/prisma validate'` | 0 | `prisma/schema.prisma` is valid |
| `npx --yes --package=node@22 --call='npm run prisma:deploy'` | 0 | Found 4 migrations; no pending migrations |
| `npx --yes --package=node@22 --call='./node_modules/.bin/prisma migrate status'` | 0 | Found 4 migrations; database schema is up to date |
| `npx --yes --package=node@22 --call='npm run lint'` | 0 | ESLint completed with `--max-warnings=0` |
| `npx --yes --package=node@22 --call='npm run typecheck'` | 0 | `tsc --noEmit` completed |
| `npx --yes --package=node@22 --call='npm run test:run'` | 0 | 38/38 files; 444/444 tests passed |
| `npx --yes --package=node@22 --call='npm run test:integration'` | 0 | 16/16 files; 103/103 PostgreSQL tests passed |
| `npx --yes --package=node@22 --call='npm audit --omit=dev --audit-level=high'` | 0 | Found 0 production vulnerabilities |
| `npx --yes --package=node@22 --call='npm run build'` | 0 | Production build compiled; 19/19 static pages generated and all routes built |
| `git diff --check` | 0 | No whitespace errors |

Next.js and TypeScript rewrote only the tracked generated files `next-env.d.ts`
and `tsconfig.tsbuildinfo` during verification. Those generated changes were
restored, leaving only the three Task 16 documentation files pending.

## Traceability and backend evidence

The traceability matrix contains exactly 199/199 `Covered` rows and no
`Missing`, `Failing`, or `Ambiguous` row. Fresh automated evidence includes:

- the 40 mandatory pure financial cases from specification §28;
- exact Decimal persistence and calculations for balances, card debt and
  credit, fee-waiver state, goals, projects, dashboard values, and reports;
- all five transaction field matrices and ownership checks for every
  referenced foreign key;
- serializable goal-allocation concurrency and rollback/no-write cases;
- mutation/activity-log atomicity and bounded 90-day retention;
- independent current-state versus selected-period dashboard/report horizons;
- all ten report loaders and their combined filters;
- two authenticated users across read, reference, mutation, search, dashboard,
  report, renewal, and export boundaries;
- a single action-entered reference ledger reconciled across PostgreSQL,
  calculations, dashboard, all reports, activity metadata, edits/deletes, and
  CSV; and
- the exact 13-column, current-user CSV route contract.

## Migration state and safety

Prisma found these four applied migrations:

1. `20260702000000_init`
2. `20260706000000_add_user_settings`
3. `20260729170000_add_rate_limit_buckets`
4. `20260730_add_financial_audit_constraints`

`prisma migrate deploy` reported no pending work and `prisma migrate status`
reported the database schema up to date. The Phase 2 migration is additive: it
adds the category fee-waiver default, two indexes, and an optional renewal
foreign key. Before adding that key it nulls only orphaned renewal references;
the constraint uses `ON DELETE SET NULL`. It contains no table drop, column
drop, or domain-row deletion.

## Independent review

Verdict: `APPROVED_BACKEND_GATE`.

The post-fix whole-branch review covered specification traceability, Decimal
safety, transaction matrices, concurrency, atomicity, ownership, migration
safety, dashboard/report horizons, all ten reports, CSV, and unit/integration
test independence. The prior release blockers were fixed by audited head
`5a28eb7a33f71d9a23cc925e0a2f84ace2fa2aee`:

- annual-fee reminders now honor the UTC day-0/day-30 boundary;
- the authenticated transaction sanitizer removes all seven poisoned relation
  fields across get, list, search, and export boundaries; and
- `adjustmentDirectionEffect` remains Decimal-safe for the exact
  `90071992547409.99` value.

## Dependency audit

The required production audit,
`npm audit --omit=dev --audit-level=high`, exited 0 with
`found 0 vulnerabilities`.

### Deferred development-only advisories

These findings are visible but separate from the production dependency gate:

- A full dependency audit reports 7 findings in dependencies omitted by the
  production-only audit: 3 moderate (`@vitest/mocker`, `esbuild`, `vite-node`),
  3 high (`brace-expansion`, `postcss`, `vite`), and 1 critical (`vitest`).
  Resolving the Vite/Vitest chain requires a separate major-version maintenance
  change. The required production audit found 0 vulnerabilities.
- Vitest prints the Vite CJS Node API deprecation notice.

### Other non-blocking gate warnings

- The linked worktree build prints Next.js's multiple-lockfile workspace-root
  inference warning.
- `npm ci` reports deprecated stub package `@types/bcryptjs` and six dependency
  install scripts not yet listed in npm's `allowScripts` configuration. Prisma
  validation, generation, tests, and the build still completed successfully.

No advisory above is represented as fixed or omitted from this report.

## Outstanding acceptance work

- Vercel Preview deployment: **not run**
- Specification §29 browser/manual QA: **not run**
- Approximately 375px mobile QA and mobile-keyboard checks: **not run**
- Preview auth/session, response-header, rate-limit, security-isolation, and
  representative write/read smoke tests: **not run**
- Production deployment: **not authorized and not run**
