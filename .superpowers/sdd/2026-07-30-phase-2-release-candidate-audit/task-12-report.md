# Task 12 Report — Hybrid Dashboard Data Horizon

- Base: `453af30af13eca0a2b482e04bfa3bea2b4f2b309`
- Scope: specification §§11.3, 12.2–12.6, 13.1–13.3, 14.4, 15.1–15.3,
  16.1, and the approved Task 12 brief

## TDD Evidence

RED was observed before each production behavior change:

- The pure whitelist fixture failed 1 of 16 dashboard tests. It expected net
  position `1400.00` but received `2399.00`, exactly `999.00` too high because
  `OTHER` was treated as an asset.
- The first real PostgreSQL fixture failed 1 of 1 test. Selected-period raw
  expense already remained `100.00`, but current net position expected
  `2520.00` and received `2899.00` because prior ledger events were omitted and
  `OTHER` was included.
- The rendered dashboard-label test failed 1 of 17 tests with zero of four
  required `Selected period` notes.
- The adversarial nested-ownership fixture failed 1 of 2 database tests.
  Goal progress expected the authenticated user's `300.00` but received
  `1000.00` after a foreign user's `700.00` contribution was included.

GREEN after the bounded fixes:

- Focused dashboard unit/render tests: 17/17.
- Focused dashboard PostgreSQL integration: 2/2.
- Historical acceptance values: selected-period expense `100.00`, current net
  position `2520.00`, current tracked card debt `85.00`.

## Implementation

- `getDashboardData(periodStart, periodEnd)` now performs two authenticated
  transaction queries:
  - `periodTransactions` uses the inclusive selected date range for raw income,
    expense, savings, quality, project summaries, and returned chart data.
  - `ledgerTransactions` uses the authenticated user's complete ledger for
    balances, credit-card state, fee-waiver cycle state, and net position.
- Active goals retain their complete contribution horizon, with nested
  contributions also filtered by the authenticated `userId`.
- Active renewals use each record's reminder window, and annual-fee reminders
  remain current-date through 30 days. Both are independently user-scoped.
- Net-position assets now whitelist exactly `CASH`, `BANK_ACCOUNT`,
  `DEBIT_CARD`, `E_WALLET`, and `INVESTMENT`; `OTHER` and card opening balances
  are excluded, while tracked card debt is subtracted.
- Decimal values stay as Prisma Decimal values throughout the calculations.
- Dashboard summary labels render `Selected period` on income, expense, net
  savings, and saving rate. Net position and credit-card state render
  `Current tracked estimate`.

## Verification

All applicable commands used Node 22.

- Focused dashboard unit/render: 17/17 passed.
- Focused dashboard PostgreSQL integration: 2/2 passed.
- Full unit suite: 30 files, 396/396 passed.
- Full PostgreSQL integration suite: 12 files, 86/86 passed.
- Typecheck: passed.
- ESLint: passed with zero warnings.
- Prisma validation: schema valid.
- `git diff --check`: passed.
- Production build: passed; all routes compiled and 19 static pages generated.

The first Prisma command nested `npx` inside the Node wrapper and exited with
npm `EUSAGE` before Prisma ran. The corrected command,
`npx --yes --package=node@22 --call='./node_modules/.bin/prisma validate'`,
passed. The test/build output otherwise contained only the repository's known
Vite CJS deprecation, Prisma update notice, and isolated-worktree
multiple-lockfile warning.

## Self-Review and Manual QA

- The real database fixture proves prior-period income, card expense, and card
  payment affect current balances/debt without entering selected-period raw
  expense.
- A literal `OTHER` opening balance of `999.00` is excluded while all five
  whitelisted asset types are covered by the pure test.
- A second-user fixture proves period transactions, sources, card state, goal
  progress, waiver-cycle spend, renewal reminders, and fee reminders remain
  isolated.
- Server-rendered dashboard content proves the exact concise horizon labels.
- No report, settings, schema, migration, or unrelated UI behavior changed.
- Generated `next-env.d.ts` and `tsconfig.tsbuildinfo` changes were restored
  before commit.

No unresolved Task 12 issue remains.

## Fix Round 1 — Active Card Widgets and Renewal Projection

Two Important review findings were reproduced with failing tests before
production changes.

### RED

- The adversarial PostgreSQL renewal test created an owned renewal referencing
  another user's category, two money sources, and project. Dashboard
  integration ran 3 tests with 2 passing and 1 failing because the returned
  renewal still had the nested `category` key and exposed the foreign records.
- The inactive-card unit fixture ran 18 tests with 17 passing and 1 failing:
  net position correctly stayed `100.00`, including both cards' debt, but the
  displayed card collection contained `active-card` and `inactive-card`.
- The matching PostgreSQL fixture ran 3 tests with 2 passing and 1 failing:
  net position correctly stayed `-30.00`, including the inactive card's
  `30.00` debt, but the displayed collection contained both card IDs.

### Implementation

- Credit-card state and fee-waiver widget collections now require both
  `CREDIT_CARD` type and `isActive`.
- Net position still receives every owned money source, so active and inactive
  card debt remain liabilities.
- The dashboard renewal query no longer includes category, source, destination,
  or project relations. It positively selects only `id`, `title`, `amount`,
  `currency`, `nextDueDate`, and `reminderDaysBefore`, the fields required by
  reminder filtering and the dashboard UI.
- The poisoned renewal remains an owned upcoming root, but no foreign nested
  record, foreign-key ID, private name, or second-user renewal root is returned.

### GREEN and Final Verification

- Focused dashboard unit/render tests: 18/18 passed.
- Focused dashboard PostgreSQL integration: 3/3 passed.
- Full unit suite: 30 files, 397/397 passed.
- Full PostgreSQL integration suite: 12 files, 87/87 passed.
- Typecheck, zero-warning ESLint, Prisma validation, `git diff --check`, and
  production build passed.

The production build emitted only the known isolated-worktree multiple-lockfile
warning. Generated `next-env.d.ts` and `tsconfig.tsbuildinfo` changes were
restored before commit. No report, settings, schema, migration, or unrelated UI
scope was changed.
