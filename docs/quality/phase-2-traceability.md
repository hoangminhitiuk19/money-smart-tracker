# Phase 2 Financial Audit Traceability

Initial audit recorded 2026-07-30. `Covered` means the cited test assertions
were inspected; it does not replace the database or cross-module evidence
listed as a later disposition. `—` means no evidence exists yet.

| Rule | Implementation | Unit evidence | DB evidence | Status | Disposition |
| --- | --- | --- | --- | --- | --- |
| §6.1 Directional money flow uses distinct from/to source IDs | `lib/calc/transactions.ts`, `lib/actions/transactions.ts` | `tests/transactions.test.ts`; `tests/finance-logic.test.ts` field-matrix assertions | — | Covered | Task 6 adds persisted workflow evidence |
| §6.2 INCOME has external source, required destination, and increases income/balance | `lib/calc/transactions.ts`, `lib/calc/balance.ts` | `tests/transactions.test.ts`; `tests/balance.test.ts` | — | Covered | Task 6 integration |
| §6.2 EXPENSE has required source, no destination, and reduces balance | `lib/calc/transactions.ts`, `lib/calc/balance.ts` | `tests/transactions.test.ts`; `tests/balance.test.ts` | — | Covered | Task 6 integration |
| §6.2 TRANSFER has two different sources and is not income/expense | `lib/calc/transactions.ts`, `lib/calc/balance.ts`, `lib/calc/dashboard.ts` | `tests/transactions.test.ts`; `tests/finance-logic.test.ts` | — | Covered | Task 6 integration |
| §6.2 REFUND has external source, required destination, and reduces linked effective expense | `lib/calc/transactions.ts`, `lib/calc/balance.ts`, `lib/calc/reports.ts` | `tests/transactions.test.ts`; `tests/reports.test.ts` | — | Covered | Task 6/12 integration |
| §6.2 ADJUSTMENT uses adjusted source and direction, not from/to, and is excluded from income/expense | `lib/calc/transactions.ts`, `lib/calc/balance.ts` | `tests/transactions.test.ts`; `tests/balance.test.ts` | — | Covered | Task 6 integration |
| §6.3 Transaction fields use session-owned references and positive decimal amount | `lib/actions/transactions.ts`, `prisma/schema.prisma` | `tests/transactions.actions.test.ts`; `tests/transactions.test.ts` | — | Missing | Task 2/6/15 persistence and ownership coverage |
| §6.4 Type field matrix and positive amount | `lib/calc/transactions.ts` | `tests/transactions.test.ts`; `tests/finance-logic.test.ts` | — | Covered | Task 6 database validation |
| §6.4 Quality rating only on EXPENSE | `lib/calc/transactions.ts`, `lib/actions/transactions.ts` | `tests/transactions.test.ts`; `tests/transactions.actions.test.ts` | — | Covered | Task 6 integration |
| §6.4 REFUND relation must be same-user EXPENSE | `lib/actions/transactions.ts` | — | — | Missing | Task 6 |
| §6.4 Fee waiver target is positive when enabled; null/zero target has zero progress | `lib/actions/money-sources.ts`, `lib/calc/credit-card.ts` | `tests/credit-card.test.ts`; `tests/finance-logic.test.ts` covers zero/null progress only | — | Missing | Task 6/7 |
| §6.4 Card billing/due days are 1–31 and last four digits are digits | `lib/actions/money-sources.ts` | — | — | Missing | Task 6 |
| §6.4 UI-inclusive end date maps to exclusive next-day DB bound | `lib/actions/dashboard.ts`, `lib/actions/reports.ts` | — | — | Missing | Task 3 |
| §6.4 Every referenced category, source, project, renewal, and related transaction is owned by the user | `lib/actions/transactions.ts` | `tests/transactions.actions.test.ts` checks selected references | — | Missing | Task 6/15 two-user proof |
| §6.5 Fee-waiver prefill is true only for eligible credit-card expenses and is manually overridable | `lib/calc/transactions.ts`, `lib/actions/transactions.ts` | `tests/transactions.test.ts`; `tests/transactions.actions.test.ts` | — | Failing | Task 4/6: excluded card expense categories are not modeled |
| §7.1 Quality scale is limited to S/A/B/C/D and only EXPENSE uses it | Prisma enum; `lib/calc/transactions.ts` | `tests/transactions.test.ts` | — | Covered | Task 6 integration |
| §7.3 High quality is S+A; low quality is C+D | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` | — | Covered | Task 11 reconciliation |
| §8.1 Category fields and per-user ownership | `prisma/schema.prisma`, `lib/actions/categories.ts` | `tests/categories.actions.test.ts` | — | Missing | Task 15 two-user CRUD evidence |
| §8.2 Expense category default quality is prefilled and overridable | `lib/category-seed.ts`, transaction form/actions | — | — | Missing | Task 4/6 |
| §8.3 All 16 seeded categories have specified types/default ratings | `lib/category-seed.ts`, `lib/actions/auth.ts` | — | — | Missing | Task 4 |
| §9.1 Goal fields and net/progress/remaining formulas | `lib/calc/goals.ts`, `lib/actions/goals.ts` | `tests/goals.test.ts`; `tests/finance-logic.test.ts` | — | Covered | Task 8 integration and Decimal audit |
| §9.2 Contributions require same-user goal, optional transaction/source, and positive amount | `lib/actions/goal-contributions.ts` | `tests/goal-contributions.actions.test.ts` | — | Missing | Task 8/15 |
| §9.2 Linked normal contributions cannot exceed transaction amount; manual/no-link exceptions apply | `lib/calc/goals.ts`, `lib/actions/goal-contributions.ts` | `tests/goals.test.ts`; `tests/finance-logic.test.ts` | — | Missing | Task 8 atomic integration |
| §10.1 Project fields are user-owned | `prisma/schema.prisma`, `lib/actions/projects.ts` | `tests/projects.actions.test.ts` | — | Missing | Task 9/15 |
| §10.2 Project totals use INCOME/EXPENSE; ROI is N/A for zero expense | `lib/calc/projects.ts` | `tests/projects.test.ts`; `tests/finance-logic.test.ts` | — | Covered | Task 2/9 Decimal and integration evidence |
| §11.1 Money-source type set | Prisma `MoneySourceType` | — | — | Missing | Task 4 schema evidence |
| §11.2 Money-source fields/defaults and user ownership | `prisma/schema.prisma`, `lib/actions/money-sources.ts` | `tests/money-sources.actions.test.ts` | — | Missing | Task 4/15 |
| §11.3 Non-card tracked-balance formula and required label | `lib/calc/balance.ts`, account pages | `tests/balance.test.ts`; `tests/finance-logic.test.ts` | — | Missing | Task 2 Decimal audit; Task 7 presentation; Task 15 integration |
| §12.1 Credit-card fields, 2–6-digit last four, and bounds | `prisma/schema.prisma`, `lib/actions/money-sources.ts` | — | — | Missing | Task 6 |
| §12.2 Credit-card expenses consume card credit before debt, in chronological order | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts`; `tests/finance-logic.test.ts` simple cases | — | Failing | Task 7 deterministic same-day ordering |
| §12.3 Debt, available credit floor, and separate card-credit formulas | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` | — | Missing | Task 2 Decimal audit; Task 7 full ledger |
| §12.4 Card-payment overflow clears debt and creates card credit | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts`; `tests/finance-logic.test.ts` | — | Covered | Task 7 integration |
| §12.5 All three credit-card refund states | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts`; `tests/finance-logic.test.ts` | — | Covered | Task 7 cross-destination regression |
| §12.6 Card credit is separate from official limit | `lib/calc/credit-card.ts`, account pages | `tests/credit-card.test.ts` | — | Missing | Task 7 presentation evidence |
| §12.7 Card view shows required tracked estimate values and labels | card detail page | — | — | Missing | Task 7/15 manual check |
| §13.1 Annual-fee fields/defaults and 30-day reminder | Prisma schema, dashboard action/page | — | — | Missing | Task 4/11 |
| §13.2 Waiver fields/defaults | Prisma schema, money-source action | — | — | Missing | Task 4/6 |
| §13.3 Eligible spend is in-period eligible card expense minus every linked refund | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts`; `tests/finance-logic.test.ts` only card-destination refund | — | Failing | Task 7 |
| §13.4 Fee-waiver prefill exclusions and manual override | `lib/calc/transactions.ts`, transaction action | `tests/transactions.test.ts` covers only generic type default | — | Failing | Task 4/6 |
| §13.5 Fee waiver is labeled tracked/verify with bank | account/dashboard UI | — | — | Missing | Task 7/15 |
| §14.1 Renewal fields/defaults and ownership | Prisma schema, `lib/actions/renewals.ts` | `tests/renewals.actions.test.ts` | — | Missing | Task 10/15 |
| §14.2 Renewal actions create/update state and required activity events | `lib/actions/renewals.ts` | `tests/renewals.actions.test.ts` rate-limit/validation coverage | — | Missing | Task 10 atomic workflow |
| §14.2 Mark-paid and skip advance exactly one overdue cycle | `lib/calc/renewals.ts`, renewal action | `tests/renewals.test.ts` | — | Covered | Task 10 integration |
| §14.3 Frequency progression and CUSTOM-as-DAILY | `lib/calc/renewals.ts` | `tests/renewals.test.ts`; `tests/finance-logic.test.ts` | — | Covered | Task 10 timezone/edge coverage |
| §14.4 Upcoming renewals are active, within reminder threshold, and soonest-first | dashboard action | — | — | Missing | Task 10/11 |
| §15.1 Dashboard summary cards are user/period scoped | `lib/actions/dashboard.ts`, `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` pure summary assertions | — | Missing | Task 11/15 |
| §15.2 Dashboard supplies six required chart projections | dashboard action/page | — | — | Missing | Task 11 |
| §15.3 Net position is non-card assets minus card debt and labeled estimate | `lib/calc/dashboard.ts`, dashboard UI | `tests/dashboard.test.ts`; `tests/finance-logic.test.ts` | — | Missing | Task 7/11 presentation and ledger |
| §16.1 Raw/effective distinction and linked-refund attribution | `lib/calc/reports.ts`, dashboard/report actions | `tests/reports.test.ts` | — | Missing | Task 12 integration |
| §16.2 Ten required report views | `lib/actions/reports.ts`, reports UI | `tests/reports.test.ts` covers selected transaction reports | — | Missing | Task 12 |
| §16.3 All report filters are user-scoped and available | `lib/actions/reports.ts` | — | — | Missing | Task 12/15 |
| §17.1 Search text/filters/page size/URL state are user-scoped | transactions action/page | — | — | Missing | Task 12/15 |
| §18.1 CSV has the specified 13 columns | export route | `tests/export.route.test.ts` exact CSV header assertion | — | Covered | Task 15 real-database export |
| §18.2 CSV is current-user-only and logs row count | export route | `tests/export.route.test.ts` asserts user-scoped query and log metadata | — | Missing | Task 15 two-user integration |
| §19 Manual receipt entry has no server OCR/upload and creates an EXPENSE | receipt upload page | — | — | Missing | Task 15 manual QA |
| §20.1 ActivityLog fields and user ownership | Prisma schema, action log helpers | `tests/categories.actions.test.ts`; `tests/money-sources.actions.test.ts` | — | Missing | Task 15 integration |
| §20.2 Required action metadata shapes | action modules and export route | `tests/categories.actions.test.ts`; `tests/export.route.test.ts` | — | Missing | Tasks 8–10/15 atomic and complete coverage |
| §20.3 Logs paginate at 50, retain 90 days, and are server-side side effects | activity-log action/page | — | — | Missing | Task 13/15 |
| §21 Settings defaults, profile, export shortcut, and placeholders | settings action/page | `tests/settings.actions.test.ts` rate-limit boundary | — | Missing | Task 13/15 |
| §22 Income/expense, effective expense, savings, and zero-income rate formulas | `lib/calc/dashboard.ts`, `lib/calc/reports.ts` | `tests/dashboard.test.ts`; `tests/reports.test.ts`; `tests/finance-logic.test.ts` | — | Missing | Task 2 Decimal and Task 11/12 reconciliation |
| §22 Spending-quality formulas | `lib/calc/dashboard.ts`, `lib/calc/reports.ts` | `tests/dashboard.test.ts`; `tests/reports.test.ts`; `tests/finance-logic.test.ts` | — | Missing | Task 11/12 reconciliation |
| §22 Goal/project/account/card/waiver/net-position formulas | `lib/calc/**` | `tests/balance.test.ts`, `tests/credit-card.test.ts`, `tests/goals.test.ts`, `tests/projects.test.ts` | — | Missing | Tasks 2, 7–9, 11 |

## §28 Automated-Test Requirements

| Rule | Implementation | Unit evidence | DB evidence | Status | Disposition |
| --- | --- | --- | --- | --- | --- |
| §28.1 `calculateTrackedBalance`: income | `lib/calc/balance.ts` | `tests/finance-logic.test.ts` exact balance assertion | — | Covered | Task 2 Decimal regression |
| §28.2 `calculateTrackedBalance`: expense | `lib/calc/balance.ts` | `tests/finance-logic.test.ts` exact balance assertion | — | Covered | Task 2 Decimal regression |
| §28.3 `calculateTrackedBalance`: refund | `lib/calc/balance.ts` | `tests/finance-logic.test.ts` exact balance assertion | — | Covered | Task 2 Decimal regression |
| §28.4 `calculateTrackedBalance`: transfer in/out | `lib/calc/balance.ts` | `tests/finance-logic.test.ts` exact balance assertion | — | Covered | Task 2 Decimal regression |
| §28.5 `calculateTrackedBalance`: adjustments | `lib/calc/balance.ts` | `tests/finance-logic.test.ts` exact balance assertion | — | Covered | Task 2 Decimal regression |
| §28.6 Credit card: expense with no credit | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 chronological ledger |
| §28.7 Credit card: credit fully covers expense | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 chronological ledger |
| §28.8 Credit card: credit partly covers expense | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 chronological ledger |
| §28.9 Credit card: payment reduces debt | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 integration |
| §28.10 Credit card: payment overflow | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 integration |
| §28.11 Credit card: refund Case A | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 integration |
| §28.12 Credit card: refund Case B | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 integration |
| §28.13 Credit card: refund Case C | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact state assertion | — | Covered | Task 7 integration |
| §28.14 Goal progress contributions/withdrawals | `lib/calc/goals.ts` | `tests/finance-logic.test.ts` exact progress assertion | — | Covered | Task 8 integration |
| §28.15 Over-contribution blocks linked normal contribution | `lib/calc/goals.ts` | `tests/finance-logic.test.ts` exact error assertion | — | Covered | Task 8 atomic test |
| §28.16 Over-contribution permits manual override | `lib/calc/goals.ts` | `tests/finance-logic.test.ts` exact success assertion | — | Covered | Task 8 follow-on limit test |
| §28.17 Over-contribution skips transaction-null contribution | `lib/calc/goals.ts` | `tests/finance-logic.test.ts` exact success assertion | — | Covered | Task 8 integration |
| §28.18 Project profit and ROI | `lib/calc/projects.ts` | `tests/finance-logic.test.ts` exact totals assertion | — | Covered | Task 9 Decimal/integration |
| §28.19 Project zero expense gives null ROI | `lib/calc/projects.ts` | `tests/finance-logic.test.ts` exact null assertion | — | Covered | Task 9 integration |
| §28.20 Waiver basic progress | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact waiver assertion | — | Covered | Task 7 cross-destination refund |
| §28.21 Waiver refund reduces eligible spending | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact waiver assertion | — | Covered | Task 7 cross-destination refund |
| §28.22 Waiver non-eligible expense exclusion | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact zero assertion | — | Covered | Task 7 integration |
| §28.23 Waiver zero/null target returns progress zero | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact zero assertions | — | Covered | Task 7 integration |
| §28.24 Waiver remaining floors at zero | `lib/calc/credit-card.ts` | `tests/finance-logic.test.ts` exact floor assertion | — | Covered | Task 7 integration |
| §28.25 Next due DAILY/WEEKLY/MONTHLY/YEARLY | `lib/calc/renewals.ts` | `tests/finance-logic.test.ts` exact date assertions | — | Covered | Task 10 timezone cases |
| §28.26 Next due interval greater than one | `lib/calc/renewals.ts` | `tests/finance-logic.test.ts` exact date assertion | — | Covered | Task 10 integration |
| §28.27 Next due CUSTOM is DAILY | `lib/calc/renewals.ts` | `tests/renewals.test.ts` exact date assertion | — | Covered | Task 10 integration |
| §28.28 Transaction type source matrix | `lib/calc/transactions.ts` | `tests/finance-logic.test.ts` valid/invalid matrix assertions | — | Covered | Task 6 action integration |
| §28.29 Quality rating rejected off EXPENSE | `lib/calc/transactions.ts` | `tests/finance-logic.test.ts` exact error assertion | — | Covered | Task 6 action integration |
| §28.30 Fee-waiver default true for card expense | `lib/calc/transactions.ts` | `tests/finance-logic.test.ts` exact boolean assertion | — | Covered | Task 4/6 exclusions |
| §28.31 Fee-waiver default false for transfer/income/refund | `lib/calc/transactions.ts` | `tests/finance-logic.test.ts` exact boolean assertions | — | Covered | Task 4/6 exclusions |
| §28.32 Adjustment increase effect | `lib/calc/transactions.ts` | `tests/finance-logic.test.ts` exact signed assertion | — | Covered | Task 6 integration |
| §28.33 Adjustment decrease effect | `lib/calc/transactions.ts` | `tests/finance-logic.test.ts` exact signed assertion | — | Covered | Task 6 integration |
| §28.34 Net savings normal case | `lib/calc/dashboard.ts` | `tests/finance-logic.test.ts` exact summary assertion | — | Covered | Task 11 reconciliation |
| §28.35 Net savings zero income rate is zero | `lib/calc/dashboard.ts` | `tests/finance-logic.test.ts` exact summary assertion | — | Covered | Task 11 reconciliation |
| §28.36 Spending-quality grouping | `lib/calc/reports.ts` | `tests/finance-logic.test.ts` exact grouped rows assertion | — | Covered | Task 12 effective-expense reconciliation |
| §28.37 Net position assets minus card debt | `lib/calc/dashboard.ts` | `tests/finance-logic.test.ts` exact position assertion | — | Covered | Task 7/11 reconciliation |
| §28.38 Ownership guard permits owner | `lib/calc/ownership.ts` | `tests/finance-logic.test.ts` exact identity assertion | — | Covered | Task 15 two-user integration |
| §28.39 Ownership guard rejects non-owner | `lib/calc/ownership.ts` | `tests/finance-logic.test.ts` exact safe-error assertion | — | Covered | Task 15 two-user integration |
| §28.40 CSV export scopes to current user | export route | `tests/export.route.test.ts` asserts `where.userId` | — | Covered | Task 15 real two-user integration |
