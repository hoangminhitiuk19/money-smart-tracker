# Task 13 Report — Complete Report Filters and Reconciliation

- Base: `806119c0096265c00a9805a029e59605c69b4e28`
- Scope: specification §§9.1–9.2, 10.2, 12.2–12.5, 13.3, 16.1–16.3,
  and the approved Task 13 brief

## TDD Evidence

RED was observed before each production behavior change:

- The first action-filter run had 2 failures and 18 existing passes. The old
  positional API interpreted the filter object as a date, so the combined
  authenticated predicate was absent and caller-supplied `userId` was not
  rejected by the filter contract.
- The first PostgreSQL report reconciliation failed 1/1 at the same missing
  object-filter boundary before it could return the reference ledger.
- The all-loader action expansion had 3 failures and 2 passes. Transaction
  views still queried only `userId`, goal progress ignored selected
  goal/source/dates, and renewal views used the obsolete months argument.
- The authenticated filter-option test failed because its loader did not
  exist.
- The rendered report-page suite failed 2/2 because the page passed positional
  local `Date` values and rendered only the two date controls.
- Self-review added a focused empty-state navigation assertion. It failed
  because the old `#report-range` target no longer existed.

GREEN after the bounded changes:

- Focused report calculation, action, and rendered UI suites: 26/26.
- Focused PostgreSQL report reconciliation: 5/5.
- Empty-state navigation points to the current filter panel without nested
  interactive elements.

## Implementation

- Added the exact `ReportFilters` contract:
  `startDate`, `endDate`, `type`, `categoryId`, `qualityRating`,
  `moneySourceId`, `projectId`, `savingGoalId`, and `groupBy`.
- Strict Zod validation rejects unknown keys, including client-supplied
  `userId`. Every loader derives ownership from `requireAuth()`.
- One shared Prisma transaction predicate applies:
  - source matching across `fromMoneySourceId`, `toMoneySourceId`, and
    `adjustedMoneySourceId`;
  - saving-goal matching through `goalContributions.some.savingGoalId`;
  - UI-inclusive end dates through an exclusive next-day bound;
  - type, category, quality, project, and authenticated ownership.
- Every transaction-derived report reuses that predicate. Goal progress applies
  meaningful goal/source/contribution-date dimensions, while renewal reports
  apply their native date/type/category/quality/source/project dimensions.
  Selected but non-meaningful dimensions remain present in the URL.
- Authenticated option queries provide only owned categories, money sources,
  projects, and saving goals.
- The report page passes the same validated URL state to all ten loaders.
- The existing report visual system now includes a compact responsive GET
  filter panel, clear labels, owned options, visible active-filter context,
  persistent URL values, plain Apply/Reset actions, mobile-sized controls, and
  visible keyboard focus. No palette, typography, or global layout changed.

## Reconciliation Evidence

The real PostgreSQL suite uses two users and literal Decimal expectations:

- income `1000.00`;
- raw expense `440.00`;
- linked refund `90.00`;
- effective expense `350.00`;
- category/quality attribution `210.00` and `140.00`;
- project raw expense `600000.00`, effective expense `500000.00`, profit
  `400000.00`, and ROI `80.00`;
- saving-goal net contribution `350.00`;
- tracked card debt `85.00`;
- fee-waiver eligible spending `210.00`;
- upcoming and recurring monthly expense `50.00`;
- User B `9999.00` sentinel transactions, card, goal, project, and renewal are
  absent from every authenticated result.

Existing pure report calculations already implemented the §16.1 linked-refund
rules, so no speculative `lib/calc/reports.ts` production rewrite was needed.
Their calculation suite remains part of the focused and full gates.

## Verification

All applicable commands used Node 22.

- Full unit/render suite: 32 files, 405/405 passed.
- Full PostgreSQL integration suite: 13 files, 92/92 passed.
- Typecheck: passed.
- ESLint: passed with zero warnings.
- Prisma validation: schema valid.
- `git diff --check`: passed.
- Production build: passed; all application routes compiled and all 19 static
  pages generated.

The first Prisma attempt nested `npx` inside the Node wrapper and exited with
npm `EUSAGE` before Prisma ran. The corrected local Prisma CLI invocation
passed. The build emitted only the repository's known isolated-worktree
multiple-lockfile workspace-root warning.

## Self-Review and Manual QA

- The exact combined predicate assertion proves the authenticated query shape
  and prevents a future single-direction source regression.
- Real database results prove Decimal preservation, raw-versus-effective
  reconciliation, all ten views, and two-user isolation.
- Server-rendered UI tests prove every control name, selected URL value, owned
  option label, active-filter count, Apply/Reset action, and empty-state jump
  target.
- Generated `next-env.d.ts` and `tsconfig.tsbuildinfo` changes were restored
  before commit.
- No schema, migration, dashboard, settings, global style, or unrelated domain
  behavior changed.

No unresolved Task 13 issue remains.

## Fix Round 1 — Effective Refund Hydration and Card Horizons

Review identified two query-horizon defects in the initial implementation.
Effective-expense views selected refunds with the report's own dimensions and
date range, which omitted later refunds and refunds paid to a different source.
The debt and fee-waiver views also reused the ordinary report predicate even
though both are stateful calculations with different chronology requirements.

### TDD Evidence

The new focused action regressions were RED with 4 failures and 4 passes:

- none of the five effective-expense loaders issued a second, same-user query
  for refunds linked to the selected expense population;
- card debt still used the combined global predicate instead of full owned
  chronology through the selected inclusive end date; and
- fee-waiver spending still used the report month and unrelated dimensions
  instead of each card's complete configured waiver period.

The expanded PostgreSQL reconciliation was also RED with 5 failures and 1
pass. Effective totals remained `440.00`, category A remained `300.00`, the
combined-filter case remained `300.00`, project expense remained `600000.00`,
and debt was `300.00` instead of the required effective/as-of values.

### Implementation

- Effective-expense loaders now first select only the filtered INCOME and
  EXPENSE population, then hydrate only authenticated-user REFUND rows whose
  `relatedTransactionId` belongs to a selected expense. Refund date,
  destination source, category, quality, project, and goal dimensions do not
  incorrectly remove a valid linked refund.
- Card debt queries the full authenticated ledger through the selected
  inclusive end date. The selected card remains a root-card filter; start date
  and unrelated report dimensions no longer truncate the state calculation.
- Fee-waiver reporting queries the authenticated ledger without report-month
  truncation. The existing calculator applies each selected card's configured
  waiver-period bounds and source eligibility.
- The public `ReportFilters` and URL contract are unchanged.

### Isolation and Boundary Coverage

The real-database fixtures now prove:

- a selected July expense is reduced from `300.00` to `210.00` by its linked
  August refund in all five effective-expense views, even when every applicable
  report dimension is selected and the refund has a different destination;
- an unrelated owned `777.00` refund and a cross-user `9999.00` linked-refund
  sentinel are excluded;
- card debt includes June state transitions, returns `85.00` as of July 31,
  and excludes a future `999.00` adjustment; and
- fee-waiver eligible spending is `210.00` across the card's configured
  January–December period despite July and unrelated global filters.

### Verification

All applicable commands used Node 22.

- Focused report calculation, action, and rendered UI suites: 28/28 passed.
- Focused PostgreSQL report reconciliation: 6/6 passed.
- Full unit/render suite: 32 files, 407/407 passed.
- Full PostgreSQL integration suite: 13 files, 93/93 passed.
- Typecheck: passed.
- ESLint: passed with zero warnings.
- Prisma validation: schema valid.
- `git diff --check`: passed.
- Production build: passed; all application routes compiled and all 19 static
  pages generated.

The build emitted only the repository's known isolated-worktree
multiple-lockfile workspace-root warning. Generated `next-env.d.ts` and
`tsconfig.tsbuildinfo` changes were restored before commit. No schema,
migration, dashboard, settings, global style, or unrelated domain behavior
changed.
