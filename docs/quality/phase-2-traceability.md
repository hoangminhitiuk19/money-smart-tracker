# Phase 2 Financial Audit Traceability

Manual audit revised 2026-07-30 (Task 1 fix round 1). `Covered` is used only
where the cited assertion proves the exact row. A `Missing` row may name a
current implementation boundary, but that boundary is not evidence. `Failing`
identifies a confirmed mismatch in the inspected code; `Ambiguous` identifies a
specification statement without an executable acceptance criterion. `—` means
no database evidence exists yet.

| Rule | Implementation | Unit evidence | DB evidence | Status | Disposition |
| --- | --- | --- | --- | --- | --- |
| §6.1 Directional model has `fromMoneySourceId` and `toMoneySourceId`, never a single ambiguous source ID | `prisma/schema.prisma`, `lib/actions/transactions.ts` | — | — | Missing | Task 6 |
| §6.2 INCOME field matrix: null from and required to | `lib/calc/transactions.ts` | `tests/transactions.test.ts` rejects the inverse/missing destination | — | Covered | Task 6 persisted workflow |
| §6.2 INCOME increases receiving non-card balance | `lib/calc/balance.ts` | `tests/balance.test.ts` exact income-balance assertion | — | Covered | Task 2 Decimal regression |
| §6.2 INCOME increases total income | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact total-income assertion | — | Covered | Task 12 reconciliation |
| §6.2 EXPENSE field matrix: required from and null to | `lib/calc/transactions.ts` | `tests/transactions.test.ts` exact invalid cases | — | Covered | Task 6 persisted workflow |
| §6.2 EXPENSE reduces paying non-card balance | `lib/calc/balance.ts` | `tests/balance.test.ts` exact expense-balance assertion | — | Covered | Task 2 Decimal regression |
| §6.2 EXPENSE increases total expense | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact total-expense assertion | — | Covered | Task 12 reconciliation |
| §6.2 Credit-card EXPENSE applies card-credit priority | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` covers no/full/partial credit cases | — | Failing | Task 7 deterministic chronology and ledger |
| §6.2 TRANSFER field matrix: two required, different sources | `lib/calc/transactions.ts` | `tests/transactions.test.ts` exact invalid cases | — | Covered | Task 6 persisted workflow |
| §6.2 TRANSFER is excluded from income/expense totals | `lib/calc/dashboard.ts` | `tests/finance-logic.test.ts` net-savings assertion includes a transfer without changing totals | — | Covered | Task 12 reconciliation |
| §6.2 TRANSFER updates source and non-card destination balances | `lib/calc/balance.ts` | `tests/balance.test.ts` exact transfer-in/out assertions | — | Covered | Task 2 Decimal regression |
| §6.2 TRANSFER to a card follows payment-overflow behavior | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` payment/overflow assertions | — | Covered | Task 7 integration |
| §6.2 REFUND field matrix: null from and required to | `lib/calc/transactions.ts` | `tests/transactions.test.ts` exact invalid cases | — | Covered | Task 6 persisted workflow |
| §6.2 REFUND is excluded from normal income | `lib/calc/dashboard.ts` | — | — | Missing | Task 12 |
| §6.2 REFUND to a non-card source increases its balance | `lib/calc/balance.ts` | `tests/balance.test.ts` exact refund-balance assertion | — | Covered | Task 2 Decimal regression |
| §6.2 Linked REFUND reduces effective expense | `lib/calc/reports.ts` | `tests/reports.test.ts` linked-refund assertions | — | Covered | Task 13 integration |
| §6.2 REFUND to a card follows the card refund state machine | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` Cases A/B/C | — | Covered | Task 7 integration |
| §6.2 ADJUSTMENT field matrix: null from/to and required adjusted source/direction | `lib/calc/transactions.ts` | `tests/transactions.test.ts` exact invalid/valid assertions | — | Covered | Task 6 persisted workflow |
| §6.2 ADJUSTMENT changes a non-card tracked balance by direction | `lib/calc/balance.ts` | `tests/balance.test.ts` exact increase/decrease assertions | — | Covered | Task 2 Decimal regression |
| §6.2 ADJUSTMENT is excluded from income and expense reporting | dashboard/report loaders | — | — | Missing | Task 6/12/13 |
| §6.2 ADJUSTMENT is labeled in every report and ActivityLog | report/activity boundaries | — | — | Missing | Task 11/13 |
| §6.2 Card ADJUSTMENT exposes both `CREDIT_CARD_DEBT` and `CARD_CREDIT` targets | transaction form/action | — | — | Missing | Task 6/7 |
| §6.2 Card ADJUSTMENT defaults to debt and lets the user toggle card credit | transaction form/action | — | — | Missing | Task 6/17 |
| §6.2 Non-card ADJUSTMENT ignores `adjustmentTarget` | transaction action/calc | — | — | Missing | Task 6 |
| §6.2 Adjustment UI shows source, direction, amount, reason, and the required helper text | transaction form | — | — | Missing | Task 17 |
| §6.3 Core transaction record fields and defaults (ID, session user, type, amount, currency, title, description, date, timestamps) | `prisma/schema.prisma`, `lib/actions/transactions.ts` | — | — | Missing | Task 6/15 |
| §6.3 Category/source/project/renewal/related references are optional only where specified and owned by the session user | `prisma/schema.prisma`, `lib/actions/transactions.ts` | `tests/transactions.actions.test.ts` checks recurring-payment ownership only | — | Missing | Task 4/6/15 |
| §6.3 Adjustment-specific fields are restricted to adjustments; quality is EXPENSE-only | `lib/calc/transactions.ts` | `tests/transactions.test.ts` and `tests/transactions.actions.test.ts` quality assertions | — | Missing | Task 6 |
| §6.3 Fee-waiver and installment defaults are persisted as specified | Prisma schema, transaction action | — | — | Missing | Task 4/6 |
| §6.4 Amount is positive and direction is encoded by type/direction | `lib/calc/transactions.ts` | `tests/transactions.test.ts` zero/negative assertions | — | Covered | Task 6 persisted validation |
| §6.4 Quality rating is null off EXPENSE | `lib/calc/transactions.ts`, transaction action | `tests/transactions.test.ts`; `tests/transactions.actions.test.ts` | — | Covered | Task 6 integration |
| §6.4 REFUND relation is a same-user EXPENSE, not another type or user | `lib/actions/transactions.ts` | — | — | Missing | Task 6/15 |
| §6.4 Enabled waiver requires a positive target | money-source action | — | — | Missing | Task 5 |
| §6.4 Null or zero waiver target yields progress zero | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` exact zero/null progress assertions | — | Covered | Task 7 |
| §6.4 Billing-cycle and payment-due days are 1–31 | money-source action | — | — | Missing | Task 5 |
| §6.4 Card last four contains only digits | money-source action | — | — | Missing | Task 5 |
| §6.4 UI-inclusive end date is an exclusive next-day DB bound | date-range boundary | — | — | Missing | Task 3 |
| §6.4 Every referenced record is owned by the user | action ownership checks | `tests/transactions.actions.test.ts` recurring-payment case only | — | Missing | Task 6/15 |
| §6.5 Global fee-waiver default is false | Prisma schema | — | — | Missing | Task 4 |
| §6.5 Card EXPENSE prefill is true | `lib/calc/transactions.ts` | `tests/transactions.test.ts`; `tests/finance-logic.test.ts` exact true assertion | — | Covered | Task 4/6 exclusions |
| §6.5 Non-card/non-EXPENSE prefill is false | `lib/calc/transactions.ts` | `tests/finance-logic.test.ts` transfer/income/refund assertions | — | Covered | Task 4/6 exclusions |
| §6.5 Card fee, interest, cash advance, and wallet top-up stay false; user may override any prefill | category/action/form boundaries | — | — | Failing | Task 4/6 |
| §7.1 Rating enum and meaning table S/A/B/C/D | Prisma `QualityRating` | — | — | Missing | Task 6 |
| §7.1 Only EXPENSE needs a rating | `lib/calc/transactions.ts` | `tests/transactions.test.ts` quality validation | — | Covered | Task 6 |
| §7.2 Rating examples guide UI/content | category/form UI | — | — | Ambiguous | Task 17 manual acceptance scope |
| §7.3 High-quality spending is S+A | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact high-quality-percent assertion | — | Covered | Task 12 reconciliation |
| §7.3 Low-quality spending is C+D | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact low-quality amount assertion | — | Covered | Task 12 reconciliation |
| §7.3 Dashboard includes quality breakdown, high-quality %, and low-quality total | dashboard action/page | — | — | Missing | Task 12/17 |
| §7 UX presents quality as reflection rather than judgment | transaction UI copy | — | — | Ambiguous | Task 17 manual acceptance scope |
| §8.1 Category fields/defaults match the specified record contract | Prisma schema, category action | — | — | Missing | Task 4/15 |
| §8.1 Category records are scoped to the authenticated user | `lib/actions/categories.ts` | action tests use one mocked user only | — | Missing | Task 15 |
| §8.2 Selecting an expense category pre-fills its default quality | transaction form | — | — | Missing | Task 6/17 |
| §8.2 User can override category quality prefill | transaction form/action | — | — | Missing | Task 6/17 |
| §8.2 Suggested category defaults are configured as listed | `lib/category-seed.ts` | — | — | Missing | Task 4 |
| §8.3 The 16 exact seeded categories/types/defaults are created for each new user | `lib/category-seed.ts`, auth registration | — | — | Missing | Task 4/15 |
| §8.3 Users can create, edit, and delete defaults as their own categories | category action | `tests/categories.actions.test.ts` activity-log calls only | — | Missing | Task 15 |
| §9.1 Saving-goal fields/defaults match the specified record contract | Prisma schema, goal action | — | — | Missing | Task 8/15 |
| §9.1 Net contribution subtracts withdrawals | `lib/calc/goals.ts` | `tests/goals.test.ts` exact withdrawal assertion | — | Covered | Task 2 Decimal regression |
| §9.1 Progress is net/target × 100 | `lib/calc/goals.ts` | `tests/goals.test.ts` exact progress assertion | — | Covered | Task 2 Decimal regression |
| §9.1 Remaining floors at zero | `lib/calc/goals.ts` | `tests/goals.test.ts` has remaining arithmetic but no over-target floor assertion | — | Missing | Task 8 |
| §9.2 Contribution fields/defaults and positive amount match the contract | Prisma schema, contribution action | — | — | Missing | Task 8/15 |
| §9.2 Normal linked contributions enforce the allocation ceiling | `lib/calc/goals.ts` | `tests/goals.test.ts`; `tests/finance-logic.test.ts` exact error assertions | — | Covered | Task 8 atomic integration |
| §9.2 Manual contribution bypasses the immediate ceiling | `lib/calc/goals.ts` | `tests/goals.test.ts`; `tests/finance-logic.test.ts` exact success assertions | — | Covered | Task 8 follow-on allocation |
| §9.2 Contribution without a transaction link skips the ceiling | `lib/calc/goals.ts` | `tests/goals.test.ts`; `tests/finance-logic.test.ts` exact success assertions | — | Covered | Task 8 integration |
| §9.2 Goal, transaction, and source references are same-user owned | contribution action | — | — | Missing | Task 8/15 |
| §10.1 Project fields/defaults match the specified record contract | Prisma schema, project action | — | `tests/integration/projects.integration.test.ts` checks session owner, nullable description, ACTIVE default, and timestamps on persisted create | Covered | Task 9 |
| §10.1 Projects are scoped to the authenticated user | project action | action tests use one mocked user only | `tests/integration/projects.integration.test.ts` checks foreign read/list/update/delete isolation and unchanged foreign state | Covered | Task 9 |
| §10.2 Project income and expense totals use their respective transaction types | `lib/calc/projects.ts` | `tests/projects.test.ts` exact totals | — | Covered | Task 2 Decimal regression |
| §10.2 Profit is income minus expense | `lib/calc/projects.ts` | `tests/projects.test.ts` exact profit | — | Covered | Task 2 Decimal regression |
| §10.2 Zero project expense displays ROI as N/A | `lib/calc/projects.ts` | `tests/projects.test.ts` exact `null` ROI | — | Covered | Task 9 |
| §10.3 Published project example computes 600,000 expense, 900,000 income, 300,000 profit, and 50% ROI | `lib/calc/projects.ts` | `tests/projects.test.ts` asserts all four literal Decimal results | — | Covered | Task 9 |
| §11.1 Money-source enum includes every specified source type | Prisma `MoneySourceType` | — | — | Missing | Task 4 |
| §11.2 Non-card source fields/defaults match the specified record contract | Prisma schema, money-source action | — | — | Missing | Task 4/5/15 |
| §11.3 Non-card formula includes income, transfers, refund, expense, and adjustments | `lib/calc/balance.ts` | `tests/balance.test.ts` exact component assertions | — | Covered | Task 2 Decimal regression |
| §11.3 Credit cards do not use the non-card formula | dashboard/account boundaries | — | — | Missing | Task 7 |
| §11.3 Every displayed balance carries the required tracked-not-official label | account UI | — | — | Missing | Task 7/17 |
| §12.1 Card fields/defaults, 2–6-digit identifier, non-negative limit, and 1–31 days | Prisma schema, money-source action | — | — | Missing | Task 5 |
| §12.2 Card-credit priority uses chronological card events | `lib/calc/credit-card.ts` | simple priority assertions in `tests/credit-card.test.ts` | — | Failing | Task 7 |
| §12.3 Debt formula includes expenses, payments/refunds, and debt adjustments | `lib/calc/credit-card.ts` | individual state tests | — | Missing | Task 2/7 |
| §12.3 Available credit is limit minus debt and floors at zero | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` exact floor assertion | — | Covered | Task 7 |
| §12.3 Card-credit formula includes initial credit, overflow, consumption, and card-credit adjustments | `lib/calc/credit-card.ts` | individual state tests omit complete chronology/adjustment ledger | — | Missing | Task 7 |
| §12.4 Payment at/below debt reduces debt without credit | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` exact payment/equal-debt assertions | — | Covered | Task 7 |
| §12.4 Payment above debt clears debt and adds overflow credit | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` exact overflow assertion | — | Covered | Task 7 |
| §12.5 Card refund below debt reduces debt | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` Case A | — | Covered | Task 7 |
| §12.5 Card refund above debt overflows to card credit | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` Case B | — | Covered | Task 7 |
| §12.5 Card refund at zero debt becomes card credit | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` Case C | — | Covered | Task 7 |
| §12.6 Card credit is displayed separately and never inflates official limit | card UI | `tests/credit-card.test.ts` calculation-only assertion | — | Missing | Task 7/17 |
| §12.7 Card view presents every listed metric with the tracked-estimate label | card detail UI | — | — | Missing | Task 7/17 |
| §13.1 Annual-fee fields/defaults match the specified card record contract | Prisma schema, money-source action | — | — | Missing | Task 5 |
| §13.1 Dashboard shows fee reminders 30 days before charge date | dashboard action/page | — | — | Missing | Task 12 |
| §13.2 Waiver fields/defaults match the specified card record contract | Prisma schema, money-source action | — | — | Missing | Task 5 |
| §13.3 Eligible spending is in-period flagged card expense | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` exact eligible-spend assertion | — | Covered | Task 7 integration |
| §13.3 Every linked refund reduces eligible spending before progress | `lib/calc/credit-card.ts` | cited tests cover only card-destination refunds | — | Failing | Task 7 |
| §13.3 Progress and remaining use target and floor correctly | `lib/calc/credit-card.ts` | `tests/credit-card.test.ts` exact progress/remaining assertions | — | Covered | Task 7 |
| §13.4 Fee-waiver default table, exclusions, and manual override | transaction/category/form boundaries | generic type defaults only | — | Failing | Task 4/6 |
| §13.5 Fee-waiver display has required fields and bank-verification label | account/dashboard UI | — | — | Missing | Task 7/17 |
| §14.1 Renewal fields/defaults match the specified record contract | Prisma schema, renewal action | — | — | Missing | Task 10/15 |
| §14.2 Mark paid writes transaction, one-cycle date, generation date, and activity entry | renewal action | rate-limit-only test | — | Missing | Task 10/11 |
| §14.2 Skip advances one cycle without transaction and logs | renewal action | `tests/renewals.test.ts` helper only | — | Missing | Task 10/11 |
| §14.2 Pause/resume/cancel/delete/edit mutate prescribed state and activity log | renewal action | `tests/renewals.actions.test.ts` rate-limit/quality cases only | — | Missing | Task 10/11 |
| §14.2 Mark paid/skip require ACTIVE renewal | renewal action | — | — | Missing | Task 10 |
| §14.2 Overdue mark/skip advances exactly one current-due cycle | `lib/calc/renewals.ts` | `tests/renewals.test.ts` exact helper assertions | — | Covered | Task 10 integration |
| §14.3 DAILY/WEEKLY/MONTHLY/YEARLY/CUSTOM frequency formulas | `lib/calc/renewals.ts` | `tests/renewals.test.ts`; `tests/finance-logic.test.ts` exact dates | — | Covered | Task 10 timezone/clamp cases |
| §14.4 Upcoming list is ACTIVE, inside reminder threshold, and soonest first | dashboard action | — | — | Missing | Task 10/12 |
| §15.1 Dashboard period filters apply to the required period analysis | dashboard action | pure tests do not query periods | — | Missing | Task 12 |
| §15.1 Dashboard current-state cards use the approved complete/domain horizon | dashboard action | — | — | Missing | Task 12 |
| §15.1 All 14 named summary cards are present and user-scoped | dashboard action/page | `tests/dashboard.test.ts` covers selected pure totals only | — | Missing | Task 12/15/17 |
| §15.2 All six named dashboard charts are supplied and rendered | dashboard action/page | — | — | Missing | Task 12/17 |
| §15.3 Net position includes only CASH/BANK/DEBIT/E-WALLET/INVESTMENT minus card debt | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact source exclusion/position assertions | — | Covered | Task 12 ledger |
| §15.3 Net-position label says it is estimated/not official bank data | dashboard UI | — | — | Missing | Task 17 |
| §16.1 Dashboard total expense and savings rate use raw expense | dashboard calc/action | `tests/dashboard.test.ts` raw total/net assertions | — | Covered | Task 12 |
| §16.1 Each listed report uses effective expense and attributes linked refunds to original records | `lib/calc/reports.ts` | `tests/reports.test.ts` proves project report expense 500,000, profit 400,000, and ROI 80% after a linked 100,000 refund; other selected report attribution assertions also exist | — | Missing | Task 9 proves project report; Task 13 completes cross-report reconciliation |
| §16.1 Unlinked refunds are not subtracted from a category/project | `lib/calc/reports.ts` | `tests/reports.test.ts` unlinked-refund assertions | — | Covered | Task 13 |
| §16.2 Income-versus-expense report | `lib/calc/reports.ts` | `tests/reports.test.ts` exact rows | — | Covered | Task 13 integration |
| §16.2 Expense-by-category report | `lib/calc/reports.ts` | `tests/reports.test.ts` exact rows | — | Covered | Task 13 integration |
| §16.2 Spending-quality report | `lib/calc/reports.ts` | `tests/reports.test.ts` exact rows | — | Covered | Task 13 integration |
| §16.2 Goal-progress report | reports action/UI | — | — | Missing | Task 13 |
| §16.2 Project profit/loss report | reports action/UI | — | — | Missing | Task 13 |
| §16.2 Spending-by-source report | `lib/calc/reports.ts` | `tests/reports.test.ts` exact rows | — | Covered | Task 13 integration |
| §16.2 Card-debt history report | reports action/UI | — | — | Missing | Task 13 |
| §16.2 Fee-waiver-progress report | reports action/UI | — | — | Missing | Task 13 |
| §16.2 Upcoming-renewals monthly report | reports action/UI | — | — | Missing | Task 13 |
| §16.2 Recurring-expense monthly report | reports action/UI | — | — | Missing | Task 13 |
| §16.3 Date/type/category/quality/source/project/goal filters apply to every report and retain ownership scope | reports action/UI | — | — | Missing | Task 13/15 |
| §17.1 Free-text title/description search | transaction list action/UI | — | — | Missing | Task 13/17 |
| §17.1 Category/source/project/type/date/quality filters | transaction list action/UI | — | — | Missing | Task 13/17 |
| §17.1 Search is paginated at 20 and URL state is shareable within the session | transaction list UI | — | — | Missing | Task 13/17 |
| §17.1 Results are user scoped | transaction list action | — | — | Missing | Task 15 |
| §18.1 CSV has the exact 13 specified columns | export route | `tests/export.route.test.ts` exact header assertion | — | Covered | Task 15 real export |
| §18.2 Only authenticated current-user transactions are exported | export route | `tests/export.route.test.ts` asserts mocked `where.userId` | — | Missing | Task 15 two-user integration |
| §18.2 Export is logged with metadata `rowCount` | export route | `tests/export.route.test.ts` exact row-count metadata assertion | — | Covered | Task 15 real export |
| §18.2 Future non-transaction exports remain out of MVP | product scope | — | — | Ambiguous | Task 17 manual scope |
| §19 Receipt selection shows a preview and manual-entry form only | receipt upload UI | — | — | Missing | Task 17 |
| §19 Manual form includes amount/date/title/category/quality/source/description and creates normal EXPENSE | receipt upload UI/action | — | — | Missing | Task 17 |
| §19 Success redirects to transactions and displays the required placeholder | receipt upload UI | — | — | Missing | Task 17 |
| §19 No OCR or server-side file upload occurs in MVP | receipt upload boundary | — | — | Missing | Task 17 |
| §20.1 ActivityLog record fields and owner contract | Prisma schema; activity builders and authenticated action modules | exact metadata assertions in action tests | `tests/integration/activity.integration.test.ts` verifies persisted owner, action, entity, and metadata fields | Covered | Task 11 |
| §20.2 Every listed action writes its specified metadata shape | typed builders in `lib/activity.ts`; transaction, money-source/card, category, goal/contribution, project, renewal, and export action modules | exact action metadata assertions across the domain suites | `tests/integration/activity.integration.test.ts`, `tests/integration/projects.integration.test.ts`, and `tests/integration/renewals.integration.test.ts` verify persisted metadata | Covered | Task 11 |
| §20.3 Log list paginates at 50 | activity-log action/page | — | — | Missing | Task 11/17 |
| §20.3 MVP retains logs for 90 days | inclusive retained-read predicate and bounded oldest-first cleanup in `lib/activity.ts`; activity-log page | `tests/activity.test.ts` verifies the inclusive cutoff and 500-row cap | `tests/integration/activity.integration.test.ts` verifies pre-cleanup filtering, exact boundary retention, bounded deletion, and cross-user preservation | Covered | Task 11 |
| §20.3 Mutations write logs server-side, not through a client call | authenticated server-action modules use one transaction client for domain mutation and activity insert | action tests verify transaction-client use and exact server-side activity writes | activity, transaction, project, goal, and renewal integration suites force activity failure and verify domain rollback | Covered | Tasks 8–11 |
| §21 Default currency setting | settings action/page | — | — | Missing | Task 14 |
| §21 Date and number format settings | settings action/page | — | — | Missing | Task 14 |
| §21 Default dashboard period setting | settings action/page | — | — | Missing | Task 14 |
| §21 Profile name/editable and email/read-only behavior | settings UI/action | — | — | Missing | Task 14/17 |
| §21 CSV export shortcut | settings UI | — | — | Missing | Task 14/17 |
| §21 Notification and theme placeholders | settings UI | — | — | Missing | Task 14/17 |
| §22 Total income and total expense formulas | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact totals | — | Covered | Task 2/12 |
| §22 Effective expense subtracts linked refunds | `lib/calc/reports.ts` | `tests/reports.test.ts` exact linked-refund rows | — | Covered | Task 2/13 |
| §22 Net savings formula | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact net assertion | — | Covered | Task 2/12 |
| §22 Saving-rate formula returns zero for zero income | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact zero-income assertion | — | Covered | Task 2/12 |
| §22 High-quality percent and zero-rated fallback | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact normal/zero assertions | — | Covered | Task 2/12 |
| §22 Low-quality amount formula | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact C+D assertion | — | Covered | Task 2/12 |
| §22 Goal progress and net-contribution formulas | `lib/calc/goals.ts` | `tests/goals.test.ts` exact assertions | — | Covered | Task 2/8 |
| §22 Project profit/ROI formulas | `lib/calc/projects.ts` | `tests/projects.test.ts` exact normal/zero-expense assertions | — | Covered | Task 2/9 |
| §22 Non-card tracked-balance formula | `lib/calc/balance.ts` | `tests/balance.test.ts` component/composite assertions | — | Covered | Task 2/7 |
| §22 Card debt/card-credit formulas and chronological payment/refund handling | `lib/calc/credit-card.ts` | simple component assertions only | — | Failing | Task 7 |
| §22 Fee-waiver eligible/progress/remaining formulas | `lib/calc/credit-card.ts` | card-destination refund assertions only | — | Failing | Task 7 |
| §22 Estimated net-position formula | `lib/calc/dashboard.ts` | `tests/dashboard.test.ts` exact position assertion | — | Covered | Task 2/12 |

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
| §28.34 Net savings normal case | `lib/calc/dashboard.ts` | `tests/finance-logic.test.ts` exact summary assertion | — | Covered | Task 12 reconciliation |
| §28.35 Net savings zero income rate is zero | `lib/calc/dashboard.ts` | `tests/finance-logic.test.ts` exact summary assertion | — | Covered | Task 12 reconciliation |
| §28.36 Spending-quality grouping | `lib/calc/reports.ts` | `tests/finance-logic.test.ts` exact grouped rows assertion | — | Covered | Task 13 effective-expense reconciliation |
| §28.37 Net position assets minus card debt | `lib/calc/dashboard.ts` | `tests/finance-logic.test.ts` exact position assertion | — | Covered | Task 7/12 reconciliation |
| §28.38 Ownership guard permits owner | `lib/calc/ownership.ts` | `tests/finance-logic.test.ts` exact identity assertion | — | Covered | Task 15 two-user integration |
| §28.39 Ownership guard rejects non-owner | `lib/calc/ownership.ts` | `tests/finance-logic.test.ts` exact safe-error assertion | — | Covered | Task 15 two-user integration |
| §28.40 CSV export scopes to current user | export route | `tests/export.route.test.ts` asserts mocked `where.userId` | — | Covered | Task 15 real two-user integration |
