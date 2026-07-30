# Task 14 Report — Apply Persisted User Settings

- Base: `b71091d76395923804af1fed6780b643ae968e03`
- Scope: specification §§5, 15, and 21; the dashboard/settings workflow in
  `codex-prompting-guide-v2.md`; the approved Task 14 brief; and the deferred
  Task 5 accessible money-source error announcement

## TDD Evidence

RED was observed before each production behavior change:

- The initial formatting/settings/dashboard/form slice failed in all four
  targeted files: five assertions failed while 22 existing assertions passed,
  and the formatter suite could not collect because `lib/user-format.ts` did
  not exist. The implementation still queried a July month for a persisted
  `Year`, rendered an English month name under `YYYY-MM-DD`, accepted a
  two-letter currency, invalidated only settings/dashboard, and omitted a live
  money-source error announcement.
- The six protected-page boundary tests failed 6/6 because accounts,
  account detail, goals, projects, renewals, and transactions did not load or
  apply persisted display settings.
- The report/settings-form expansion failed five assertions with seven
  existing assertions passing. Reports had no settings prop; settings status
  was not live-announced; overlong profile/password values were accepted; and
  a persistence exception escaped.
- Password self-review tests failed 2/10 before bcrypt validation measured
  UTF-8 bytes and password-verification exceptions were contained.
- The explicit dashboard-month regression failed 1/22 because
  `?period=month` incorrectly fell back to a persisted `Year`.

GREEN after the bounded changes:

- Focused formatter, settings, dashboard, form, page-boundary, and report
  suites: 7 files, 50/50 passed.

## Implementation

- Added `formatUserMoney` and `formatUserDate` in `lib/user-format.ts`.
  Money formatting keeps Prisma Decimal precision through rounding and string
  grouping, honors both persisted number formats, and uses a value's currency
  before the user default. Date-only values use stable UTC calendar fields and
  all three allowed persisted date formats.
- Accounts, account detail, dashboard, goals, projects, renewals, reports, and
  transactions each load settings exactly once at their protected page
  boundary. Values with their own currency retain it; currency-less aggregates
  and new-record defaults use `defaultCurrency`.
- Dashboard URLs now use persisted `Week`, `Month`, or `Year` only when the URL
  omits a valid period. Explicit week, month, year, and custom periods win.
  Local date-input serialization also avoids shifting a calendar date across a
  timezone boundary.
- Report cards, tables, chart axes, and tooltips use the shared formatter.
  Goal and card values retain their own currencies; aggregate report values
  use the user's default currency.
- Settings validation now accepts only the specified date/number/period
  values, normalizes a three-letter currency, limits names to 100 characters,
  enforces bcrypt's 72-byte UTF-8 password boundary, verifies the current
  password, and returns safe errors for verification or persistence failures.
- Profile and settings writes use only the `requireAuth()` user ID. The email
  remains read-only and is not submitted or written. Successful updates
  revalidate every page that renders persisted display settings.
- Settings success/error messages and asynchronous money-source errors use
  persistent accessible live regions. The settings submit button exposes its
  pending state and prevents duplicate submission.

## Ownership, Precision, and Boundary Review

- Unit assertions prove a client-supplied email cannot enter the profile
  update and both profile/settings writes are scoped to the authenticated
  user's ID.
- Decimal formatting covers a value above `Number.MAX_SAFE_INTEGER` with exact
  cents, so displayed financial strings do not depend on a lossy `Number`
  conversion.
- Server-rendered boundary tests prove each listed page uses its one settings
  load, its required currency source, persisted grouping, and persisted
  calendar-date format.
- A source scan found no remaining direct `Intl.NumberFormat`,
  `Intl.DateTimeFormat`, or `toLocale*` formatting in the listed page
  boundaries or report client.

## Verification

All applicable commands used Node 22.

- Focused Task 14 suites: 7 files, 50/50 passed.
- Full unit/render suite: 36 files, 436/436 passed.
- Full PostgreSQL integration suite: 13 files, 93/93 passed.
- Typecheck: passed.
- ESLint: passed with zero warnings.
- Prisma validation: schema valid.
- `git diff --check`: passed.
- Production build: passed; all application routes compiled and all 19 static
  pages generated.

The build emitted only the repository's known isolated-worktree
multiple-lockfile workspace-root warning. This task did not change the Prisma
schema, so no migration was created. Generated `next-env.d.ts` and
`tsconfig.tsbuildinfo` changes were restored before commit.

## Self-Review and QA

- Rechecked the approved Task 14 acceptance boundaries against the final diff.
- Confirmed exactly one `getUserSettings()` call in each listed protected page.
- Confirmed explicit dashboard URL periods override persisted defaults,
  including the previously missed explicit `month` case.
- Confirmed inactive live regions remain mounted for assistive technology and
  become visible without changing the established visual system.
- Render-level tests cover the affected page and form output; no standalone
  authenticated browser session was run for this server-rendered task.

No unresolved Task 14 issue remains.

## Fix Round 1 — Persisted Report Filter Dates

Review found that the report filter form correctly preserved ISO
`YYYY-MM-DD` values for URL submission, but the visible active-filter context
repeated those raw values instead of applying the user's persisted date
format.

### TDD Evidence

- The rendered report regression was RED with 1 failure and 3 existing passes.
  With `dateFormat: "DD/MM/YYYY"`, the date inputs retained
  `2026-07-01`/`2026-07-31`, while the active-filter chips incorrectly showed
  those same raw ISO strings instead of `01/07/2026`/`31/07/2026`.
- After the minimal change, the rendered report suite passed 4/4 and the
  focused Task 14 suite passed 51/51.

### Implementation

- `ReportFilterPanel` now receives the already-loaded `formatSettings` and
  applies `formatUserDate` only when constructing the visible `From` and
  `Through` filter labels.
- Filter state, GET query names, URL values, and date-input values remain the
  original ISO strings, preserving the existing parsing and shareable-URL
  contract.

### Verification

All applicable commands used Node 22.

- Focused Task 14 suites: 7 files, 51/51 passed.
- Full unit/render suite: 36 files, 437/437 passed.
- Full PostgreSQL integration suite: 13 files, 93/93 passed.
- Typecheck: passed.
- ESLint: passed with zero warnings.
- Prisma validation: schema valid.
- `git diff --check`: passed.
- Production build: passed; all application routes compiled and all 19 static
  pages generated.

The build emitted only the repository's known isolated-worktree
multiple-lockfile workspace-root warning. Generated `next-env.d.ts` and
`tsconfig.tsbuildinfo` changes were restored before commit. No unresolved
Fix Round 1 issue remains.
