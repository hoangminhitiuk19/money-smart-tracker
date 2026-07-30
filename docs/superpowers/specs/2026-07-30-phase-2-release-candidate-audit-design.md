# Phase 2 Release-Candidate Audit Design

## Context

Phase 1 established a supported Node.js 22 and Next.js 15 runtime, repeatable
quality gates, validated environment variables, HTTP security headers, and
distributed rate limiting. The merged baseline passes 188 Vitest tests, two
rate-limit database integration tests, the production build, and the
production-only dependency audit.

That evidence does not yet prove the complete financial backend. Most
database-backed financial workflows, cross-module reconciliation, two-user
isolation, and the manual acceptance checklist remain unverified. Product
specification §§6–22 define the controlling financial behavior; §§28–32 define
the required tests, manual QA, deployment checks, limitations, and success
criteria. The prompting guide's Phase 14 and Phase 15 checks remain the
workflow reference.

Vercel Preview deployment is blocked until every backend and financial
release gate in this design passes.

## Goals

- Produce a traceable mapping from every applicable specification rule to its
  implementation and verification evidence.
- Verify all financial calculations with deterministic, independently
  calculated expectations.
- Exercise server-action and Prisma workflows against the disposable Neon
  database.
- Prove ownership isolation using two test users.
- Reconcile database state, dashboard values, reports, activity logs, and CSV
  export against one reference ledger.
- Fix confirmed defects through failing regression tests, minimal changes, and
  independent review.
- Deploy a release candidate to Vercel Preview only after the backend gate is
  clean, then complete the specification's manual and mobile acceptance checks.

## Non-Goals

This phase does not add product features, change financial rules, redesign the
UI, add real OCR, introduce production data, or deploy to Production. It does
not upgrade the Vitest/Vite toolchain unless the existing version prevents
reliable audit execution. Cosmetic findings are recorded for a later UX phase
and are not silently added to scope.

## Sequential Release Gates

### Gate 1: Specification Traceability

Create a traceability matrix covering specification §§6–22 and the automated
requirements in §28. Each rule receives exactly one status:

- covered and passing;
- missing test coverage;
- failing implementation; or
- ambiguous specification or behavior.

The matrix records the specification reference, production file or boundary,
test evidence, expected result, and disposition. Existing tests count only
after their assertions are inspected; test names alone are not proof.
Ambiguities stop that audit item for user discussion rather than being resolved
by assumption.

### Gate 2: Pure Financial-Logic Verification

Audit deterministic calculations for:

- all transaction types and their directional field matrix;
- non-card balances and adjustments;
- credit-card debt, card credit, payments, overflow, and all refund states;
- annual-fee waiver eligibility, refund adjustment, progress, and remaining
  amount;
- goal contributions, withdrawals, over-contribution, and manual overrides;
- project income, expense, profit or loss, and ROI;
- renewal date progression and upcoming-renewal selection;
- raw versus effective expense;
- dashboard summaries, estimated net position, and all required reports.

Expected results are hand-calculated fixture values. Tests must not construct
their expected values by calling the production function under test.

### Gate 3: Database-Backed Workflow Verification

Use real Prisma persistence and server-action orchestration with an injected
authenticated test identity. Cover create, update, delete, status, payment, and
linked-record workflows. Verify:

- resulting rows and relationships;
- ownership of every referenced foreign key;
- activity-log records;
- rollback or no-write behavior on validation, ownership, and rate-limit
  failure;
- recalculated balances and summaries after edits and deletes;
- inclusive UI date ranges and exclusive database upper bounds.

Database suites remain opt-in from the ordinary unit-test command and run only
against the disposable database. Fixtures use unique audit identifiers and
perform bounded cleanup. A complete audit run may clear or reset the disposable
database, but never a Production database.

### Gate 4: Security and Cross-Module Reconciliation

Create two isolated users with similarly shaped records. Prove User A cannot
read, reference, mutate, report on, or export User B's data.

The same reference ledger must produce matching results across:

```text
server actions -> PostgreSQL state -> pure calculations
               -> dashboard -> reports -> CSV export
```

Any disagreement is a release-blocking defect even when the individual module
test passes.

## Deterministic Reference Ledger

The reference ledger contains:

- two users;
- bank, cash, e-wallet, and credit-card money sources;
- categories with and without default quality ratings;
- a saving goal, financial project, and renewal;
- fixed timestamps and all five transaction types;
- card-credit consumption, payment overflow, and the three refund states;
- fee-waiver-eligible, excluded, and refund-adjusted spending;
- goal contribution, withdrawal, blocked over-contribution, and manual
  override cases;
- renewal payment, skip, pause, and cancellation cases.

Fixed expectations include balances, debt, card credit, fee-waiver progress,
goal progress, project ROI, dashboard cards, report rows and totals, activity
events, and CSV rows. Currency math uses the same decimal precision promised by
the schema, while the expected values remain independent of production
calculation helpers.

## Defect Workflow

Financial-result, security, ownership, data-integrity, and missing-required-test
findings block release. For each confirmed defect:

1. Add a focused regression test and demonstrate the intended failure.
2. Apply the smallest specification-compliant fix.
3. Run focused and full relevant verification.
4. Obtain an independent task review.
5. Update the traceability matrix and defect record.

Work proceeds one bounded task at a time. Scope expansion requires approval.
If an apparent fix changes a financial rule rather than restoring the written
rule, stop and discuss it before implementation.

## Backend Verification Gate

Before Vercel work begins, fresh Node.js 22 evidence must show:

- every traceability entry resolved;
- unit and pure-calculation suites passing;
- financial database integration suites passing;
- two-user isolation passing;
- dashboard, reports, activity logs, and CSV reconciled;
- Prisma schema valid and migrations current;
- lint and typecheck passing;
- zero high or critical production dependency findings;
- production build passing;
- clean whole-phase review and clean tracked worktree.

Development-only dependency advisories remain visible in the audit report and
become a separate maintenance phase unless they compromise this test evidence.

## Vercel Preview and Acceptance

After the backend gate passes, use the disposable Neon database as the Preview
database. Do not use Production credentials or personal financial data.
Configure only:

- `DATABASE_URL`;
- `NEXTAUTH_SECRET`; and
- `NEXTAUTH_URL`.

Deploy once to establish the Preview address, set `NEXTAUTH_URL` to the actual
Preview or stable branch URL, and redeploy before acceptance testing.

The Preview checklist covers registration, login, logout, session persistence,
protected routes after logout, the complete reference-ledger flows, two-user
isolation, CSV export, rate limiting, response headers, and the product
specification's manual QA list. Mobile checks use an approximately 375-pixel
viewport and cover forms, navigation, tables, charts, dialogs, empty states,
loading states, and safe error messages.

Evidence is recorded as passed, failed, or unavailable. Any financial,
security, ownership, or data-integrity failure returns to the regression-test
and fix workflow. Preview deployment does not authorize Production deployment.

## Definition of Done

Phase 2 is complete only when:

- the specification traceability matrix has no unresolved entries;
- all deterministic and database-backed financial checks pass;
- two-user isolation and cross-module reconciliation pass;
- every confirmed blocking defect has regression coverage and independent
  review;
- the complete backend verification gate passes;
- Vercel Preview is deployed with the exact approved environment names;
- the manual, security, and mobile acceptance checklists pass; and
- the final report lists all evidence and any explicitly approved deferred
  non-blockers.

Production deployment remains a separate phase and requires explicit user
approval.
