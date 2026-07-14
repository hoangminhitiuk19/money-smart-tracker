# Codex Prompting Guide v2 — Money Quality Tracker

This guide tells you exactly what to say to Codex (or Claude Code / any AI
coding assistant) at each phase. Follow phases in order. Do not skip ahead.

---

## Golden Rules

Follow these every single session:

1. **One phase at a time.** Never ask Codex to build the whole app in one prompt.
2. **Paste the relevant spec rule into the prompt.** Do not assume Codex remembers.
3. **Ask for tests alongside any pure logic function.** Say "write Vitest tests for this" every time.
4. **Verify before moving on.** Ask Codex: "List what you just created and confirm what tests pass."
5. **Correct precisely.** If Codex makes a mistake, say: "That is wrong. The spec says: [paste rule]. Fix only this part."
6. **No unsolicited refactoring.** If Codex suggests a large refactor, say: "Do not refactor anything outside this task."
7. **Environment variables.** Always use `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. Never use `AUTH_SECRET` or `AUTH_URL`. Be consistent.

---

## Phase Order

| Phase | Module | Why this order |
|---|---|---|
| 0 | Project setup | Foundation |
| 1 | Database schema | All models before any code |
| 2 | Authentication | Required before any protected page |
| 3 | Categories | Simple CRUD, no dependencies |
| 4 | Accounts & Wallets | Required before Transactions |
| 5 | Financial Projects (basic CRUD only) | Transaction form needs project selector |
| 6 | Transactions | Depends on sources and projects |
| 7 | Credit Card Tracking | Extends money sources |
| 8 | Saving Goals & Contributions | Depends on transactions |
| 9 | Renewals | Depends on transactions |
| 10 | Dashboard (split into 5 sub-phases) | Depends on all modules |
| 11 | Reports (split into sub-phases) | Depends on all modules |
| 12 | Search & CSV Export | Depends on transactions |
| 13 | Activity Log | Depends on all mutations |
| 14 | Core Logic Tests | Tests all pure functions |
| 15 | Final checks | Security, mobile, empty states |

**Why Accounts & Wallets before Transactions:**
Every transaction needs `fromMoneySourceId` / `toMoneySourceId`. The
transaction form needs source selectors. The `countTowardFeeWaiver`
pre-fill logic checks whether the selected source is a CREDIT_CARD.
If money sources do not exist yet, transaction validation cannot be built.

**Why Financial Projects before Transactions:**
The transaction form has a project selector. You only need basic project
CRUD at this stage — not the full project dashboard.

---

## Phase 0 — Project Setup

### Prompt 0.1 — Initialize project

```
Create a new Next.js 14 project using App Router with TypeScript and Tailwind CSS.

Install these dependencies:
- prisma and @prisma/client
- zod
- react-hook-form and @hookform/resolvers
- recharts
- next-auth@4 (pin to v4 — do not install next-auth@latest or Auth.js v5)
- bcryptjs and @types/bcryptjs
- vitest and @vitejs/plugin-react for unit testing

Create a .env.example file with exactly these variable names:
  DATABASE_URL=
  NEXTAUTH_SECRET=
  NEXTAUTH_URL=

Never use AUTH_SECRET or AUTH_URL. Use NEXTAUTH_SECRET and NEXTAUTH_URL
throughout the entire codebase consistently.

Do not commit any .env file with real values.

Create this folder structure:
  app/           - Next.js App Router pages
  components/    - Shared UI components
  lib/           - Server logic, actions, helpers
  lib/actions/   - Server actions per module
  lib/calc/      - Pure calculation functions (testable, no DB)
  prisma/        - Prisma schema and migrations
  types/         - Shared TypeScript types
  tests/         - Vitest test files

Initialize Prisma with PostgreSQL provider.
Create a README.md with:
- How to copy .env.example to .env
- How to run prisma migrate dev
- How to run the dev server
- How to run tests
```

---

## Phase 1 — Database Schema

Build the full schema before writing any application logic.
Run one migration at the end of this phase.

### Prompt 1.1 — Enums and core models

```
Define all Prisma enums and core models in prisma/schema.prisma.

Enums to create:
  TransactionType:    INCOME, EXPENSE, TRANSFER, REFUND, ADJUSTMENT
  CategoryType:       INCOME, EXPENSE, BOTH, TRANSFER, OTHER
  QualityRating:      S, A, B, C, D
  MoneySourceType:    CASH, BANK_ACCOUNT, CREDIT_CARD, DEBIT_CARD,
                      E_WALLET, INVESTMENT, OTHER
  ProjectStatus:      ACTIVE, COMPLETED, PAUSED
  GoalStatus:         ACTIVE, COMPLETED, PAUSED
  ContributionType:   CONTRIBUTION, WITHDRAWAL
  RenewalStatus:      ACTIVE, PAUSED, CANCELLED
  RenewalFrequency:   DAILY, WEEKLY, MONTHLY, YEARLY, CUSTOM
  AdjustmentDirection: INCREASE, DECREASE
  AdjustmentTarget:   CREDIT_CARD_DEBT, CARD_CREDIT
  (Note: ACCOUNT_BALANCE is NOT an enum value — non-card adjustment uses
   adjustedMoneySourceId + adjustmentDirection only)
  CardNetwork:        VISA, MASTERCARD, JCB, NAPAS, AMEX, OTHER
  FeeFrequency:       YEARLY, MONTHLY, QUARTERLY, CUSTOM
  WaiverPeriod:       YEARLY, MONTHLY, STATEMENT_CYCLE, CUSTOM

Models:
  User:
    id, email (unique), name, passwordHash, createdAt, updatedAt

  Category:
    id, userId, name, type (CategoryType), color?, icon?,
    defaultQualityRating (QualityRating?), isDefault (default false),
    createdAt, updatedAt
    relation: User

  MoneySource:
    id, userId, name, type (MoneySourceType),
    providerName?, displayIdentifier?, currency (default "VND"),
    openingBalance (default 0), description?, isActive (default true),
    createdAt, updatedAt
    relation: User
    (Credit card fields will be added in prompt 1.2)

  FinancialProject:
    id, userId, name, description?, status (ProjectStatus default ACTIVE),
    createdAt, updatedAt
    relation: User

Do not run migration yet.
```

### Prompt 1.2 — Transaction and remaining models

```
Continue building prisma/schema.prisma. Add these models:

Transaction:
  id, userId, type (TransactionType), amount (Decimal), currency (default "VND"),
  title, description?,
  transactionDate (DateTime),
  categoryId? → Category (SetNull on delete),
  qualityRating (QualityRating?),
  fromMoneySourceId? → MoneySource (SetNull, relation name "FromSource"),
  toMoneySourceId? → MoneySource (SetNull, relation name "ToSource"),
  adjustedMoneySourceId? → MoneySource (SetNull, relation name "AdjustedSource"),
  adjustmentDirection (AdjustmentDirection?),
  adjustmentTarget (AdjustmentTarget?),
  projectId? → FinancialProject (SetNull on delete),
  relatedTransactionId? → Transaction self-relation (SetNull),
  countTowardFeeWaiver (default false),
  recurringPaymentId? (String, no FK enforced in MVP),
  isInstallmentRelated (default false),
  createdAt, updatedAt
  relation: User

SavingGoal:
  id, userId, name, targetAmount (Decimal), currency (default "VND"),
  deadline?, description?, status (GoalStatus default ACTIVE),
  createdAt, updatedAt
  relation: User

GoalContribution:
  id, userId, savingGoalId → SavingGoal,
  transactionId? → Transaction (SetNull),
  fromMoneySourceId? → MoneySource (SetNull),
  amount (Decimal), type (ContributionType),
  isManualAdjustment (default false),
  note?, contributionDate,
  createdAt, updatedAt
  relation: User

RecurringPayment:
  id, userId, fromMoneySourceId? → MoneySource (SetNull, "RenewalFrom"),
  toMoneySourceId? → MoneySource (SetNull, "RenewalTo"),
  categoryId? → Category (SetNull),
  projectId? → FinancialProject (SetNull),
  title, description?, amount (Decimal), currency (default "VND"),
  transactionType (TransactionType — only INCOME/EXPENSE/TRANSFER),
  qualityRating (QualityRating?),
  countTowardFeeWaiver (default false),
  frequency (RenewalFrequency), intervalCount (default 1),
  nextDueDate, reminderDaysBefore (default 3),
  autoCreateTransaction (default false),
  status (RenewalStatus default ACTIVE),
  lastGeneratedDate?,
  createdAt, updatedAt
  relation: User

Also add all credit card fields to MoneySource:
  cardLastFourDigits?, cardNetwork (CardNetwork?), openedDate?,
  creditLimit (Decimal?), initialOutstandingDebt (Decimal default 0),
  initialCardCredit (Decimal default 0),
  billingCycleDay (Int?), paymentDueDay (Int?),
  hasAnnualFee (default false), annualFeeAmount (Decimal?),
  annualFeeCurrency (default "VND"), annualFeeChargeDate?,
  annualFeeFrequency (FeeFrequency?), firstYearFeeWaived (default false),
  freeYearsCount (Int?), feeWaivedUntilDate?,
  annualFeeWaiverEnabled (default false),
  annualFeeWaiverSpendTarget (Decimal?),
  annualFeeWaiverPeriod (WaiverPeriod?),
  waiverPeriodStartDate?, waiverPeriodEndDate?,
  annualFeeWaiverNote?

Add ReceiptUpload:
  id, userId, fileUrl, extractedData (Json?), status (String), createdAt, updatedAt

Add ActivityLog:
  id, userId, action (String), entityType (String), entityId (String?),
  metadata (Json?), createdAt
  relation: User

Now run:
  npx prisma migrate dev --name init
```

---

## Phase 2 — Authentication

### Prompt 2.1 — NextAuth setup

```
Set up NextAuth.js with credentials provider.

Requirements:
- Use exactly these environment variable names: NEXTAUTH_SECRET, NEXTAUTH_URL
  Do not use AUTH_SECRET or AUTH_URL anywhere.
- Hash passwords with bcryptjs (never store plaintext)
- JWT session strategy
- Never expose passwordHash in session, API responses, or client components

Create:
  app/(auth)/login/page.tsx    — login form
  app/(auth)/register/page.tsx — register form

Create lib/auth.ts exporting:
  getCurrentUser()  — reads session server-side, returns user or null
  requireAuth()     — calls getCurrentUser(), redirects to /login if null
  Never read userId from request body or query params.

Register server action (lib/actions/auth.ts):
  Zod schema: email (valid email), password (min 8 chars), name (required)
  On success: create User with hashed password, seed 16 default categories
  (see category seeding prompt in Phase 3)

Protect all routes under app/(protected)/ with a layout that calls requireAuth().
```

### Prompt 2.2 — Protected layout and landing page

```
Create app/(protected)/layout.tsx:
  - Calls requireAuth() at the top — redirects to /login if no session
  - Renders sidebar navigation: Dashboard, Transactions, Goals, Projects,
    Accounts, Renewals, Reports, Activity Log, Settings
  - Shows user name and logout button

Create app/page.tsx (landing):
  - Title: "Money Quality Tracker"
  - Tagline: "Track not only where your money goes, but whether it was worth it."
  - "Get Started" button → /register
  - Brief feature list (see spec section 32)
```

---

## Phase 3 — Categories

### Prompt 3.1

```
Build the Categories module.

Server actions in lib/actions/categories.ts:
  createCategory(data)    — userId always from session
  updateCategory(id, data) — verify ownership first
  deleteCategory(id)       — verify ownership; return error if transactions
                             reference this category instead of deleting
  listCategories()         — scoped to current user only
  getCategory(id)          — verify ownership

Zod schema:
  name: string min 1
  type: CategoryType enum
  color: optional string (hex)
  icon: optional string
  defaultQualityRating: optional QualityRating enum
  isDefault: boolean default false

Seed function seedDefaultCategories(userId):
  Creates these 16 categories for a new user with isDefault = true:
  - Salary          (INCOME)
  - Food            (EXPENSE, defaultQualityRating: B)
  - Drink           (EXPENSE, defaultQualityRating: B)
  - Education       (EXPENSE, defaultQualityRating: A)
  - Health          (EXPENSE, defaultQualityRating: A)
  - Transport       (EXPENSE, defaultQualityRating: B)
  - Housing         (EXPENSE, defaultQualityRating: B)
  - Shopping        (EXPENSE, defaultQualityRating: C)
  - Entertainment   (EXPENSE, defaultQualityRating: B)
  - Subscription    (EXPENSE, defaultQualityRating: C)
  - Investment      (EXPENSE, defaultQualityRating: A)
  - Side Business   (BOTH)
  - Credit Card Payment (TRANSFER)
  - Annual Fee      (EXPENSE, defaultQualityRating: C)
  - Refund          (OTHER)
  - Other           (BOTH, defaultQualityRating: B)

Call seedDefaultCategories(userId) inside the register server action.

Page: app/(protected)/categories/page.tsx
  - Table: name, type, default quality rating badge, color swatch
  - Add / Edit / Delete actions
  - Empty state if no categories
```

---

## Phase 4 — Accounts & Wallets

Build this before Transactions — transactions depend on money sources.

### Prompt 4.1 — Money source CRUD and balance calculation

```
Build the Accounts & Wallets module.

Server actions in lib/actions/money-sources.ts:
  createMoneySource(data)      — log MONEY_SOURCE_CREATED to ActivityLog
  updateMoneySource(id, data)  — verify ownership; log MONEY_SOURCE_UPDATED
  deleteMoneySource(id)        — verify ownership; block if transactions
                                 reference it (return error, not delete)
  listMoneySources()           — scoped to current user
  getMoneySource(id)           — verify ownership

Pure function in lib/calc/balance.ts — calculateTrackedBalance(source, transactions):
  Return:
    source.openingBalance
    + SUM(INCOME   where toMoneySourceId   = source.id)
    + SUM(TRANSFER where toMoneySourceId   = source.id)
    + SUM(REFUND   where toMoneySourceId   = source.id)   ← refunds increase balance
    - SUM(EXPENSE  where fromMoneySourceId = source.id)
    - SUM(TRANSFER where fromMoneySourceId = source.id)
    + SUM(ADJUSTMENT INCREASE where adjustedMoneySourceId = source.id)
    - SUM(ADJUSTMENT DECREASE where adjustedMoneySourceId = source.id)

  This function must NOT call the database. Accept transactions as an array.
  This formula applies to non-credit-card sources only.

Pages:
  app/(protected)/accounts/page.tsx
    - List all sources: type icon, name, type label, tracked balance (labeled "Tracked")
    - "Add Account" button
    - isActive toggle

  app/(protected)/accounts/[id]/page.tsx
    - Show tracked balance with label: "Tracked in this app"
    - Recent transactions list
    - If type is CREDIT_CARD: show credit card section (built in Phase 7)

Write Vitest tests for calculateTrackedBalance in tests/balance.test.ts:
  1. Income increases balance
  2. Expense decreases balance
  3. Transfer in increases balance
  4. Transfer out decreases balance
  5. Refund increases balance           ← critical: this was missing in v1
  6. Adjustment INCREASE adds to balance
  7. Adjustment DECREASE subtracts from balance
  8. Combined: multiple transaction types
  9. Empty transactions → returns openingBalance
```

---

## Phase 5 — Financial Projects (Basic CRUD)

You only need basic CRUD here — not the full dashboard. That comes after
transactions exist.

### Prompt 5.1

```
Build basic Financial Projects CRUD.

Server actions in lib/actions/projects.ts:
  createProject(data)      — log PROJECT_CREATED to ActivityLog
  updateProject(id, data)  — verify ownership; log PROJECT_UPDATED
  deleteProject(id)        — verify ownership; log PROJECT_DELETED
  listProjects()           — scoped to current user
  getProject(id)           — verify ownership

Pure function in lib/calc/projects.ts — calculateProjectSummary(transactions):
  totalIncome  = SUM(INCOME  where projectId = project)
  totalExpense = SUM(EXPENSE where projectId = project)
  profit       = totalIncome - totalExpense
  roi          = totalExpense > 0 ? (profit / totalExpense) * 100 : null
  Return: { totalIncome, totalExpense, profit, roi }

Pages:
  app/(protected)/projects/page.tsx
    - List: name, status badge, quick profit/loss if transactions exist
    - "Add Project" button

  app/(protected)/projects/[id]/page.tsx — placeholder for now
    (Will be filled in after transactions exist)

Write Vitest tests for calculateProjectSummary:
  1. Normal profit case
  2. Loss case (negative profit)
  3. Zero expense → roi is null, no divide-by-zero error
  4. Zero income → negative profit
```

---

## Phase 6 — Transactions

This is the most important phase. Take it in three steps.

### Prompt 6.1 — Validation and server actions

```
Build transaction server actions in lib/actions/transactions.ts.

Important spec rules to follow exactly:

Money flow per type:
  INCOME:     fromMoneySourceId = null, toMoneySourceId required
  EXPENSE:    fromMoneySourceId required, toMoneySourceId = null
  TRANSFER:   both required, must be different IDs
  REFUND:     fromMoneySourceId = null, toMoneySourceId required
  ADJUSTMENT: fromMoneySourceId = null, toMoneySourceId = null,
              adjustedMoneySourceId required, adjustmentDirection required

countTowardFeeWaiver pre-fill rule:
  if type = EXPENSE AND fromMoneySourceId points to CREDIT_CARD source:
    pre-fill countTowardFeeWaiver = true
  else:
    pre-fill countTowardFeeWaiver = false
  User can always override.

Server actions:
  createTransaction(data)
    - userId always from session
    - Verify ownership of: categoryId, fromMoneySourceId, toMoneySourceId,
      adjustedMoneySourceId, projectId, relatedTransactionId
    - Validate type-specific from/to rules
    - Log TRANSACTION_CREATED to ActivityLog

  updateTransaction(id, data)
    - Verify transaction ownership first
    - Verify ownership of all referenced records
    - Log TRANSACTION_UPDATED to ActivityLog

  deleteTransaction(id)
    - Verify ownership
    - Log TRANSACTION_DELETED to ActivityLog

  listTransactions(filters)
    - Always scoped to current userId
    - Supports: type, categoryId, moneySourceId, projectId, qualityRating,
      startDate, endDate, search query
    - Paginated: page, pageSize default 20

Write Vitest tests for transaction validation in tests/transactions.test.ts:
  1. INCOME rejects fromMoneySourceId
  2. INCOME requires toMoneySourceId
  3. EXPENSE requires fromMoneySourceId
  4. EXPENSE rejects toMoneySourceId
  5. TRANSFER requires both, rejects when same ID
  6. REFUND requires toMoneySourceId
  7. ADJUSTMENT requires adjustedMoneySourceId and adjustmentDirection
  8. Amount must be positive
  9. countTowardFeeWaiver pre-fills true for credit card expense
  10. countTowardFeeWaiver stays false for TRANSFER
```

### Prompt 6.2 — Transaction list page

```
Build app/(protected)/transactions/page.tsx.

Features:
  - Paginated table: date, title, type badge, amount, category,
    quality rating badge, from source, to source
  - Search bar (title + description, debounced 300ms)
  - Filters: type, date range, category, quality rating, money source
  - URL updates with query params on filter change
  - "Add Transaction" button → /transactions/new
  - Empty state with CTA

Type badge colors:
  INCOME: green | EXPENSE: red | TRANSFER: blue
  REFUND: orange | ADJUSTMENT: gray

Quality rating badge colors:
  S: purple | A: green | B: blue | C: yellow | D: red
```

### Prompt 6.3 — Transaction form

```
Build the transaction form at:
  app/(protected)/transactions/new/page.tsx
  app/(protected)/transactions/[id]/edit/page.tsx

Form behavior by type:
  INCOME:
    - Show toMoneySourceId selector
    - No quality rating field

  EXPENSE:
    - Show fromMoneySourceId selector
    - Show quality rating field
    - If category selected has defaultQualityRating, pre-fill quality rating
    - If fromMoneySourceId is CREDIT_CARD:
        pre-fill countTowardFeeWaiver = true
        show toggle to override
        show helper text: "This counts toward your card's fee waiver progress"

  TRANSFER:
    - Show both fromMoneySourceId and toMoneySourceId selectors
    - Show warning if toMoneySourceId is CREDIT_CARD:
        "This will reduce your tracked card debt"

  REFUND:
    - Show toMoneySourceId selector
    - Show relatedTransactionId picker (search past EXPENSE transactions)
    - Show helper text: "Link to the original purchase if possible"

  ADJUSTMENT:
    - Show adjustedMoneySourceId selector
    - Show adjustmentDirection toggle: Increase / Decrease
    - If source is CREDIT_CARD: show adjustmentTarget toggle (Debt / Card Credit)
    - Show helper text: "This corrects your tracked balance. It does not
      count as income or expense."

Confirmation dialog before delete.
All money source selectors only show sources owned by the current user.
```

---

## Phase 7 — Credit Card Tracking

### Prompt 7.1 — Credit card pure functions

```
Build credit card calculation functions in lib/calc/credit-card.ts.

All functions are pure — no database calls. Accept data as parameters.

calculateCreditCardState(source, transactions):
  Computes from scratch in chronological order.

  State variables: debt = source.initialOutstandingDebt, cardCredit = source.initialCardCredit

  For each transaction chronologically:

    EXPENSE from this card — apply card credit priority rule:
      if cardCredit > 0 AND expense <= cardCredit:
        cardCredit -= expense          (debt unchanged)
      if cardCredit > 0 AND expense > cardCredit:
        debt += expense - cardCredit
        cardCredit = 0
      if cardCredit = 0:
        debt += expense

    TRANSFER to this card — apply payment overflow rule:
      if payment <= debt: debt -= payment
      if payment > debt:
        overflow = payment - debt
        debt = 0
        cardCredit += overflow

    REFUND to this card — apply refund state machine:
      if debt > 0 and refund <= debt: debt -= refund
      if debt > 0 and refund > debt:
        overflow = refund - debt
        debt = 0
        cardCredit += overflow
      if debt = 0: cardCredit += refund

    ADJUSTMENT CREDIT_CARD_DEBT INCREASE: debt += amount
    ADJUSTMENT CREDIT_CARD_DEBT DECREASE: debt -= amount
    ADJUSTMENT CARD_CREDIT INCREASE: cardCredit += amount
    ADJUSTMENT CARD_CREDIT DECREASE: cardCredit -= amount

  Return:
    { outstandingDebt: debt, availableCredit: MAX(0, creditLimit - debt), cardCredit }

calculateFeeWaiverState(source, transactions):
  eligibleSpending:
    SUM of EXPENSE transactions where:
      fromMoneySourceId = source.id
      AND countTowardFeeWaiver = true
      AND transactionDate within waiver period
    MINUS SUM of REFUND amounts linked to those eligible transactions

  If source.annualFeeWaiverSpendTarget is null or 0: return progress = 0, remaining = 0.

  Return:
    { eligibleSpending, progress, remaining }
    where:
      progress  = (eligibleSpending / source.annualFeeWaiverSpendTarget) * 100
      remaining = MAX(0, source.annualFeeWaiverSpendTarget - eligibleSpending)

Write Vitest tests in tests/credit-card.test.ts:
  1.  Basic expense increases debt (no card credit)
  2.  Expense fully covered by card credit → debt unchanged, credit reduced
  3.  Expense partially covered by card credit → credit = 0, debt += remainder
  4.  Expense when card credit = 0 → debt += full expense
  5.  Payment reduces debt
  6.  Payment exactly equals debt → debt = 0, credit unchanged
  7.  Payment exceeds debt → debt = 0, credit = overflow
  8.  Refund when debt exists and refund < debt
  9.  Refund when debt exists and refund > debt → overflow to credit
  10. Refund when debt = 0 → all goes to credit
  11. Available credit = creditLimit - debt (floor at 0)
  12. Card credit does not increase creditLimit display
  13. Fee waiver: eligible spending calculated correctly
  14. Fee waiver: refund deducted from eligible spending
  15. Fee waiver: non-eligible transaction excluded
  16. Fee waiver: remaining floors at 0 when eligible exceeds target
  17. Fee waiver: target = 0 → progress = 0, no divide-by-zero
```

### Prompt 7.2 — Credit card detail page

```
Build the credit card section on app/(protected)/accounts/[id]/page.tsx
for sources where type = CREDIT_CARD.

Use calculateCreditCardState() and calculateFeeWaiverState() from lib/calc/.
Fetch all transactions for this source and pass to the functions.
Do not recalculate in the component — compute server-side.

Display:
  Credit limit:          [amount]
  Tracked debt:          [amount]   ← labeled "Tracked estimate"
  Available credit:      [amount]
  Card credit:           [amount]   ← only if > 0, shown separately
  Payments this month:   [amount]
  Expenses this month:   [amount]

  Annual fee section (if hasAnnualFee):
    Annual fee: [amount]
    Next charge: [date] — "[X] days away"
    Waived until: [date] — if feeWaivedUntilDate is set

  Fee waiver section (if annualFeeWaiverEnabled):
    Target: [amount]/[period]
    Tracked eligible: [amount]
    Remaining: [amount]
    Progress bar: [%]
    Label: "Tracked in this app — verify with your bank"

All monetary values labeled: "Tracked estimate from your records"
```

---

## Phase 8 — Saving Goals & Contributions

### Prompt 8.1

```
Build the Saving Goals module.

Pure function in lib/calc/goals.ts — calculateGoalProgress(contributions):
  netContributed = SUM(CONTRIBUTION amounts) - SUM(WITHDRAWAL amounts)
  return { netContributed, progressPercent, remaining }

Server actions in lib/actions/goals.ts:
  createGoal, updateGoal, deleteGoal, listGoals, getGoal
  All scoped to current user.

Server actions in lib/actions/goal-contributions.ts:
  createContribution(data):
    Over-contribution check:
      if transactionId is set AND isManualAdjustment = false:
        existing = SUM contributions linked to this transactionId
        if existing + amount > transaction.amount:
          return error: "Total contributions to this transaction exceed its
          amount. Enable manual adjustment to override."
    Verify ownership of: savingGoalId, transactionId, fromMoneySourceId
    All must belong to same user.
    Log GOAL_CONTRIBUTION_CREATED to ActivityLog.

  updateContribution(id, data) — verify ownership; log GOAL_CONTRIBUTION_UPDATED
  deleteContribution(id)       — verify ownership; log GOAL_CONTRIBUTION_DELETED
  listContributionsForGoal(goalId) — verify goal ownership first

Pages:
  app/(protected)/goals/page.tsx — goal cards with progress bars
  app/(protected)/goals/[id]/page.tsx — goal detail, contributions list,
    "Add Contribution" and "Add Withdrawal" buttons
  Contribution form: optional transaction link, optional money source,
    amount, type, note, date, isManualAdjustment toggle

Write Vitest tests in tests/goals.test.ts:
  1. Progress with contributions only
  2. Progress with withdrawals reduces total
  3. Over-contribution blocked (with transactionId, isManualAdjustment false)
  4. Over-contribution allowed (isManualAdjustment = true)
  5. No over-contribution check when transactionId = null
  6. Remaining calculation
```

---

## Phase 9 — Renewals

### Prompt 9.1

```
Build the Renewals module.

Pure function in lib/calc/renewals.ts — calculateNextDueDate(current, frequency, intervalCount):
  DAILY:   add intervalCount days
  WEEKLY:  add intervalCount × 7 days
  MONTHLY: add intervalCount months
  YEARLY:  add intervalCount years
  CUSTOM:  treat as DAILY for MVP

Server actions in lib/actions/renewals.ts:

  createRenewal(data)  — log RENEWAL_CREATED to ActivityLog
  updateRenewal(id, data) — verify ownership; log RENEWAL_UPDATED
  listRenewals(filter?: { status }) — scoped to current user
  getUpcomingRenewals() — status ACTIVE, nextDueDate <= today + reminderDaysBefore

  markRenewalAsPaid(id):
    1. Verify ownership
    2. Create a transaction from renewal fields:
         type = transactionType, amount, currency, title,
         fromMoneySourceId, toMoneySourceId, categoryId,
         qualityRating, countTowardFeeWaiver,
         recurringPaymentId = renewal.id
    3. newNextDueDate = calculateNextDueDate(renewal.nextDueDate, frequency, intervalCount)
       (advance exactly one cycle from current nextDueDate, even if result is in the past)
    4. Update renewal: nextDueDate = newNextDueDate, lastGeneratedDate = today
    5. Log RENEWAL_MARKED_PAID to ActivityLog
    6. Return created transaction

  skipRenewalCycle(id):
    1. Verify ownership
    2. newNextDueDate = calculateNextDueDate(renewal.nextDueDate, frequency, intervalCount)
    3. Update renewal: nextDueDate = newNextDueDate
    4. Log RENEWAL_SKIPPED to ActivityLog
    5. Do NOT create a transaction

  pauseRenewal(id):
    1. Verify ownership
    2. Set status = PAUSED (no date change)
    3. Log RENEWAL_PAUSED to ActivityLog

  resumeRenewal(id):
    1. Verify ownership
    2. Set status = ACTIVE (no date change)
    3. Log RENEWAL_RESUMED to ActivityLog

  cancelRenewal(id):
    1. Verify ownership
    2. Set status = CANCELLED
    3. Log RENEWAL_CANCELLED to ActivityLog

  deleteRenewal(id):
    1. Verify ownership
    2. Hard delete
    3. Log RENEWAL_DELETED to ActivityLog

Page: app/(protected)/renewals/page.tsx
  - Tabs: ACTIVE / PAUSED / CANCELLED
  - Upcoming section (within reminderDaysBefore window) highlighted at top
  - Per-row actions menu: Mark as Paid, Skip, Pause/Resume, Cancel, Edit, Delete
  - Delete requires confirmation dialog

Write Vitest tests in tests/renewals.test.ts:
  1. calculateNextDueDate: DAILY
  2. calculateNextDueDate: WEEKLY
  3. calculateNextDueDate: MONTHLY
  4. calculateNextDueDate: YEARLY
  5. calculateNextDueDate: intervalCount = 2 months
  6. markRenewalAsPaid: advances exactly one cycle, even if result still in past
  7. skipRenewalCycle: advances date, no transaction created
  8. calculateNextDueDate: CUSTOM behaves as DAILY
```

---

## Phase 10 — Dashboard

Split into 5 sub-phases. Do not combine them.

### Prompt 10.1 — Dashboard calculation functions

```
Build all dashboard calculation functions in lib/calc/dashboard.ts.
All functions are pure — no database calls. Accept data as parameters.

getDashboardSummary(transactions, goals, projects, moneySources, renewals, today):
  Return:
    totalIncome:          SUM(INCOME in period)
    totalExpense:         SUM(EXPENSE in period)
    netSavings:           totalIncome - totalExpense
    savingRate:           totalIncome > 0 ? (netSavings/totalIncome)*100 : 0
    qualityBreakdown:     { S, A, B, C, D } counts and amounts
    highQualityPercent:   (S+A total) / (all rated total) * 100
    lowQualityAmount:     C+D total
    spendingBySource:     group EXPENSE by fromMoneySourceId
    estimatedNetPosition: SUM(non-card tracked balances) - SUM(card debt)

All calculations must match the formulas in spec section 22 exactly.
```

### Prompt 10.2 — Dashboard calculation tests

```
Write Vitest tests for getDashboardSummary in tests/dashboard.test.ts.

Test cases:
  1. Total income correct
  2. Total expense correct
  3. Net savings correct
  4. Saving rate: normal case
  5. Saving rate: zero income → returns 0, not error
  6. Quality breakdown: all five ratings counted separately
  7. High-quality %: S+A / total rated
  8. High-quality %: no rated expenses → returns 0
  9. Low-quality amount: C+D sum
  10. Spending by source: correct grouping
  11. Estimated net position: assets minus card debt
  12. Estimated net position: only non-card sources in assets
```

### Prompt 10.3 — Dashboard data loader (server)

```
Build the server-side data loader in lib/actions/dashboard.ts.

getDashboardData(userId, startDate, endDate):
  - Fetch all transactions in period for userId
  - Fetch all active saving goals for userId
  - Fetch all projects for userId
  - Fetch all money sources for userId (with credit card fields)
  - Fetch upcoming renewals (nextDueDate <= today + reminderDaysBefore)
  - Fetch upcoming card fees (annualFeeChargeDate within 30 days)
  - Call getDashboardSummary() with fetched data
  - Call calculateCreditCardState() per credit card source
  - Call calculateFeeWaiverState() per waiver-enabled card
  - Call calculateGoalProgress() per goal
  - Call calculateProjectSummary() per project
  - Return all results as one object

All queries must be scoped to userId. Never load another user's data.
```

### Prompt 10.4 — Dashboard summary cards UI

```
Build app/(protected)/dashboard/page.tsx — summary cards only (no charts yet).

Period selector: This Week | This Month | This Year | Custom Date Range
  Updates URL params. Page re-fetches via getDashboardData.

Render these summary cards:
  1. Total income
  2. Total expense
  3. Net savings
  4. Saving rate
  5. High-quality %
  6. Low-quality amount
  7. Estimated net position
     Label: "Estimated from your records — not official bank data"
  8. Active goals (top 3) with progress bars
  9. Active projects with profit/loss
  10. Credit card debt per active card
  11. Fee waiver progress per waiver-enabled card
  12. Upcoming renewals list (soonest first)
  13. Upcoming card fee reminders

All credit card and waiver values labeled: "Tracked estimate"
```

### Prompt 10.5 — Dashboard charts

```
Add Recharts charts to the dashboard below the summary cards.

Charts to add:
  1. Income vs Expense over time — LineChart or BarChart
     x-axis: date grouped by day/week/month based on period
     y-axis: amount in VND

  2. Expense by category — PieChart
     Each slice: category name, total amount

  3. Spending quality breakdown — PieChart
     Slices: S, A, B, C, D with distinct colors

  4. Spending by account/wallet — BarChart
     x-axis: source name, y-axis: expense amount

  5. Saving goal progress — horizontal progress bars
     One bar per active goal

  6. Project profit/loss — BarChart
     One bar per project, colored green (profit) or red (loss)

All charts must be responsive (use ResponsiveContainer from recharts).
Do not load chart data separately — reuse data already fetched by getDashboardData.
```

---

## Phase 11 — Reports

Split into calculation and UI. Do not combine.

### Prompt 11.1 — Report calculation functions

```
Build report calculation functions in lib/calc/reports.ts.
All pure functions, no database calls.

RAW vs EFFECTIVE expense rule — apply consistently:
  raw expense      = SUM(EXPENSE transactions)
  effective expense = SUM(EXPENSE) - SUM(REFUND amounts where relatedTransactionId
                      links to an EXPENSE in the same set)

  Reports that use EFFECTIVE expense:
    - Income vs expense over time
    - Expense by category (refund reduces its linked category's total)
    - Spending quality breakdown
    - Project profit/loss (refund reduces project cost)
    - Spending by source (refund reduces the linked source's total)

  Reports that use RAW expense:
    - Dashboard total expense summary card only

  Unlinked refunds (no relatedTransactionId): do not subtract from any category/project.

getIncomeVsExpenseOverTime(transactions, groupBy: 'day'|'week'|'month'):
  Group INCOME by period (raw income)
  Group effective EXPENSE by period
  Return: [{ period, income, expense }]

getExpenseByCategory(transactions, categories):
  Group effective EXPENSE by categoryId (subtract linked refunds per category)
  Return: [{ categoryName, total }]

getSpendingQualityBreakdown(transactions):
  Group effective rated EXPENSE by qualityRating
  Return: [{ rating, count, total }]

getSpendingBySource(transactions, sources):
  Group effective EXPENSE by fromMoneySourceId
  Return: [{ sourceName, total }]

Write Vitest tests for each function in tests/reports.test.ts:
  - Normal case
  - Linked refund reduces the correct category/source total
  - Unlinked refund does NOT reduce any category or source
  - Empty array edge case
```

### Prompt 11.2 — Report data loaders

```
Build server-side data loaders in lib/actions/reports.ts.

Each loader:
  - Reads userId from session (never from client)
  - Accepts: startDate, endDate, and optional filters
  - Queries only transactions owned by this user
  - Calls the corresponding pure function from lib/calc/reports.ts

Loaders:
  loadIncomeVsExpenseOverTime(userId, start, end, groupBy)
  loadExpenseByCategory(userId, start, end)
  loadSpendingQualityBreakdown(userId, start, end)
  loadGoalProgressReport(userId)
  loadProjectProfitLoss(userId)
  loadSpendingBySource(userId, start, end)
  loadCreditCardDebtReport(userId)
  loadFeeWaiverReport(userId)
  loadUpcomingRenewalsTotal(userId, months)
  loadRecurringExpensePerMonth(userId, start, end)
```

### Prompt 11.3 — Reports page UI

```
Build app/(protected)/reports/page.tsx.

Tab or section layout for these 10 report views:
  1. Income vs Expense — LineChart/BarChart
  2. Expense by Category — PieChart + table
  3. Spending Quality Breakdown — PieChart + table
  4. Saving Goal Progress — progress bars
  5. Project Profit/Loss — BarChart + table
  6. Spending by Account/Wallet — BarChart
  7. Credit Card Debt — summary table per card
  8. Annual Fee Waiver Progress — progress bars per card
  9. Upcoming Renewals Total — month-by-month total
  10. Recurring Expenses Per Month — BarChart

Global filter bar: date range, shared across all tabs.
All charts use ResponsiveContainer (responsive layout).
Each section has a loading state (skeleton) and empty state.
```

---

## Phase 12 — Search & CSV Export

### Prompt 12.1 — Search

```
Upgrade the transactions list with full search.

Server action searchTransactions(filters):
  filters: {
    q?: string  (searches title and description with case-insensitive match)
    type?: TransactionType
    categoryId?: string
    moneySourceId?: string  (matches fromMoneySourceId OR toMoneySourceId)
    projectId?: string
    qualityRating?: QualityRating
    startDate?: Date
    endDate?: Date
    page: number (default 1)
    pageSize: number (default 20)
  }
  Always scope to authenticated userId.
  Return: { transactions, total, page, pageSize }

Update the transactions page:
  - Search input debounces 300ms
  - URL query params updated on search/filter change
  - Pagination controls
```

### Prompt 12.2 — CSV Export

```
Build CSV export at app/api/export/transactions/route.ts (GET).

Behavior:
  1. Read userId from session — never from query params
  2. Accept optional: startDate, endDate query params
  3. Query all matching transactions for this user
  4. Generate CSV with these exact columns:
     Date, Type, Title, Amount, Currency, Category, Quality Rating,
     From Source, To Source, Project, Description,
     Count Toward Fee Waiver, Created At
  5. Return response with headers:
     Content-Type: text/csv
     Content-Disposition: attachment; filename="transactions.csv"
  6. Log CSV_EXPORTED to ActivityLog:
     { exportedAt: now, rowCount: number of rows }

Add "Export CSV" button to transactions page.
The route must return 401 if user is not authenticated.
```

---

## Phase 13 — Activity Log

### Prompt 13.1

```
Build the Activity Log page at app/(protected)/activity-log/page.tsx.

Requirements:
  - Show log entries for current user only
  - Paginate at 50 entries per page
  - Filter by action type
  - Display columns: timestamp, action label, entity type, entity ID, summary

Human-readable summaries per action:
  TRANSACTION_CREATED:  "Created [type] transaction: [title] ([amount] VND)"
  TRANSACTION_UPDATED:  "Updated transaction: [title]"
  TRANSACTION_DELETED:  "Deleted transaction: [title]"
  RENEWAL_MARKED_PAID:  "Marked [title] as paid — next due: [date]"
  RENEWAL_SKIPPED:      "Skipped [title] — next due: [date]"
  CSV_EXPORTED:         "Exported [rowCount] transactions to CSV"
  (etc.)

Verify all of these are already being logged:
  createTransaction, updateTransaction, deleteTransaction
  createContribution, updateContribution, deleteContribution
  createMoneySource, updateMoneySource
  createProject, updateProject, deleteProject
  markRenewalAsPaid, skipRenewalCycle, pauseRenewal, resumeRenewal,
  cancelRenewal, deleteRenewal
  CSV export

ActivityLog entries must be written inside the server action as a side effect,
not as a separate client request.
```

---

## Phase 14 — Core Logic Tests

Run this as a separate focused session after all pure functions exist.

### Prompt 14.1

```
Write a complete Vitest test suite in tests/finance-logic.test.ts.
Import from lib/calc/ only. No database. All tests use mock data arrays.

Cover every function listed in spec section 28 (Automated Test Requirements).
That is 40 test cases total. Here they are:

1.  calculateTrackedBalance — income increases balance
2.  calculateTrackedBalance — expense decreases balance
3.  calculateTrackedBalance — REFUND increases balance         ← do not miss this
4.  calculateTrackedBalance — transfer in/out correct
5.  calculateTrackedBalance — adjustment INCREASE and DECREASE
6.  calculateCreditCardState — expense with no card credit increases debt
7.  calculateCreditCardState — expense fully covered by card credit, debt unchanged
8.  calculateCreditCardState — expense partially covered by card credit
9.  calculateCreditCardState — payment reduces debt
10. calculateCreditCardState — payment overflow → card credit
11. calculateCreditCardState — refund reduces debt (Case A)
12. calculateCreditCardState — refund overflows debt (Case B)
13. calculateCreditCardState — refund when debt = 0 (Case C)
14. calculateGoalProgress — contributions and withdrawals
15. overContributionCheck — blocked with transaction link
16. overContributionCheck — bypassed with isManualAdjustment
17. overContributionCheck — no check when transactionId = null
18. calculateProjectSummary — profit and ROI
19. calculateProjectSummary — zero expense → ROI is null
20. calculateFeeWaiverState — basic eligible spending
21. calculateFeeWaiverState — refund deducted from eligible
22. calculateFeeWaiverState — non-eligible transaction excluded
23. calculateFeeWaiverState — target zero or null returns 0 progress
24. calculateFeeWaiverState — remaining floors at 0
25. calculateNextDueDate — DAILY
26. calculateNextDueDate — WEEKLY
27. calculateNextDueDate — MONTHLY
28. calculateNextDueDate — YEARLY
29. calculateNextDueDate — intervalCount = 2
30. validateTransactionFields — each type's from/to rules
31. validateTransactionFields — qualityRating rejected on non-EXPENSE
32. countTowardFeeWaiverDefault — pre-fills true for credit card expense
33. countTowardFeeWaiverDefault — stays false for TRANSFER / INCOME / REFUND
34. adjustmentDirectionEffect — INCREASE adds to balance
35. adjustmentDirectionEffect — DECREASE subtracts from balance
36. calculateNetSavings — normal case
37. calculateNetSavings — zero income → saving rate = 0
38. calculateSpendingQualityBreakdown — correct grouping
39. calculateEstimatedNetPosition — assets minus card debt
40. ownershipGuard — passes when userId matches, throws when not

Each test must have a descriptive name, clear mock data, and exact assertions.
```

---

## Phase 15 — Final Checks

Run each as a separate focused session.

### Prompt 15.1 — Security audit

```
Review every file in lib/actions/ and app/api/.

Check each server action and API route for these issues:

1. Does it call requireAuth() and read userId from session only?
   Fail: reading userId from req.body, req.query, or params.
   Fix: replace with session userId.

2. Does it verify ownership before reading, updating, or deleting?
   Fail: querying by id only without checking userId.
   Fix: add WHERE userId = sessionUserId to every query.

3. Does it verify ownership of all referenced foreign keys?
   (categoryId, fromMoneySourceId, toMoneySourceId, adjustedMoneySourceId,
   projectId, savingGoalId, relatedTransactionId)
   Fail: using a referenced ID without confirming it belongs to this user.
   Fix: add existence check per foreign key.

4. Does the CSV export route return 401 for unauthenticated requests?

List every issue found with file path and line number.
Fix all issues. Then confirm the list is clear.
```

### Prompt 15.2 — Mobile layout

```
Review all protected pages for mobile usability on a 375px viewport.

Requirements:
  - Data tables: scrollable horizontally OR collapse to card layout
  - Forms: inputs must be at least 44px tap target height
  - Sidebar: collapses to bottom nav or hamburger on mobile (md: breakpoint)
  - Charts: wrapped in ResponsiveContainer
  - Confirm dialogs: full-width on mobile
  - Buttons: touch-friendly size

Fix any issues using Tailwind responsive classes (sm:, md:, lg:).
Do not change desktop layout.
```

### Prompt 15.3 — Empty states and loading states

```
Add proper empty states and loading states to all main pages.

Empty states (use a helpful icon + message + CTA button):
  Transactions:   "No transactions yet — Add your first one"
  Goals:          "No saving goals yet — Create your first goal"
  Projects:       "No projects yet — Create your first project"
  Accounts:       "No accounts yet — Add your first account"
  Renewals:       "No renewals yet — Add your first subscription"
  Activity Log:   "No activity recorded yet"
  Reports:        "No data for this period — Try a different date range"

Loading states:
  Add a loading.tsx file for each protected page.
  Use skeleton cards (gray placeholder blocks) — not spinner-only.
  Wrap async page sections in <Suspense> boundaries.
```

### Prompt 15.4 — Receipt Upload placeholder and Settings page

```
Build two remaining MVP pages.

1. app/(protected)/receipt-upload/page.tsx

   This is a placeholder — no OCR, no AI. Just a manual entry flow.

   Steps:
     a. User clicks "Upload Receipt" and selects an image file
     b. Image is displayed on screen (preview only, not saved to server in MVP)
     c. Below the image, show a manual transaction entry form with:
          - Amount
          - Date (default today)
          - Merchant / Title
          - Category selector
          - Quality rating selector
          - Money source selector (fromMoneySourceId)
          - Description / note
     d. "Create Transaction" button submits the form as a normal EXPENSE transaction
        using the existing createTransaction server action
     e. On success, redirect to /transactions with a success message
     f. Show placeholder text: "Receipt scanning coming soon"

   No file upload to server in MVP. Image preview is client-side only.

2. app/(protected)/settings/page.tsx

   Settings form with these fields:
     - Default currency (text input, default "VND")
     - Date format (select: DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD)
     - Number format (select: 1,000,000 | 1.000.000)
     - Default dashboard period (select: Week | Month | Year)
     - Profile info: name and email (read-only email, editable name)
     - Change password section: current password, new password, confirm

   Save settings to a UserSettings table or as JSON on the User record.
   Settings must be scoped to the authenticated user.

   Also add:
     - "Export CSV" button that links to /api/export/transactions
     - Placeholder section: "Notifications — coming soon"
     - Placeholder section: "App theme — coming soon"
```

---

## Multi-Agent Workflow (Recommended)

Do not run multiple agents in parallel from the start. Use this sequence:

### Phases 0–6: Main Builder only

One thread builds the foundation:
schema → auth → categories → accounts → projects → transactions.

Architectural foundations must not be split across agents.

### Phases 7–13: Staggered agents

After each module is complete:

1. Main Builder finishes a module
2. You run build + migration to confirm no errors
3. Test Agent writes Vitest tests for that module's pure functions
4. Review Agent checks security and ownership rules for that module
5. Main Builder fixes issues, then moves to the next module

| Agent | Start after | Responsibility |
|---|---|---|
| Main Builder | Day 1 | All implementation |
| Test Agent | Phase 4 complete | Vitest tests per module |
| Review Agent | Phase 6 complete | Security + ownership audit |
| UI Agent | Phase 10 complete | Mobile layout + empty states |

### Phase 15: Coordinated finish

Run all three check prompts (security, mobile, empty states) sequentially
before deployment.

---

## Quick Reference — Key Rules to Paste Into Any Prompt

When Codex drifts from the spec, paste these directly:

**Transaction from/to rules:**
```
INCOME:     from = null,     to = required
EXPENSE:    from = required, to = null
TRANSFER:   from = required, to = required, must differ
REFUND:     from = null,     to = required
ADJUSTMENT: from = null,     to = null,
            adjustedMoneySourceId = required,
            adjustmentDirection = required (INCREASE | DECREASE)
```

**Tracked account balance (non-credit-card):**
```
balance =
  openingBalance
  + SUM(INCOME to this source)
  + SUM(TRANSFER to this source)
  + SUM(REFUND to this source)          ← include refunds
  - SUM(EXPENSE from this source)
  - SUM(TRANSFER from this source)
  + SUM(ADJUSTMENT INCREASE on this source)
  - SUM(ADJUSTMENT DECREASE on this source)
```

**Credit card expense — card credit priority rule:**
```
if cardCredit > 0 and expense <= cardCredit: cardCredit -= expense (debt unchanged)
if cardCredit > 0 and expense > cardCredit:  debt += expense - cardCredit; cardCredit = 0
if cardCredit = 0:                            debt += expense
```

**Credit card payment overflow:**
```
if payment <= debt: debt -= payment
if payment > debt:
  overflow = payment - debt
  debt = 0
  cardCredit += overflow
```

**Credit card refund state machine:**
```
if debt > 0 and refund <= debt: debt -= refund
if debt > 0 and refund > debt:
  overflow = refund - debt; debt = 0; cardCredit += overflow
if debt = 0: cardCredit += refund
```

**Fee waiver formula:**
```
eligible = SUM(EXPENSE from card where countTowardFeeWaiver = true and in period)
           - SUM(REFUND amounts linked to those eligible transactions)
progress  = (eligible / target) * 100
remaining = MAX(0, target - eligible)
```

**Ownership rule:**
```
Every server action must:
1. Get userId from session via requireAuth() — never from client
2. Verify record.userId === sessionUserId before read/update/delete
3. Verify all referenced foreign keys also belong to sessionUserId
```

**Environment variables:**
```
Always: NEXTAUTH_SECRET and NEXTAUTH_URL
Never:  AUTH_SECRET or AUTH_URL
```

---

## Common Codex Mistakes and Fixes

| Mistake | Fix prompt |
|---|---|
| Uses `userId` from request body | "Security issue. Read userId from session only via requireAuth(). Never from req.body or params. Fix all server actions." |
| Uses `moneySourceId` instead of `from`/`to` | "Do not use moneySourceId. Use fromMoneySourceId and toMoneySourceId. Paste the type rules above and fix." |
| Missing REFUND from balance formula | "REFUND transactions where toMoneySourceId = this source must increase tracked balance. Add this to calculateTrackedBalance." |
| Credit card expense always increases debt | "Apply the card credit priority rule first. If cardCredit > 0, consume it before adding to debt. Paste the card credit priority rule and fix calculateCreditCardState." |
| Negative credit card debt on overpayment | "Apply the payment overflow rule. If payment > debt: debt = 0, cardCredit += overflow. Never allow negative debt." |
| Reports use raw expense everywhere | "Effective expense = raw expense minus linked refunds. Apply this to category, source, quality, project, and income-vs-expense reports. Dashboard total card uses raw expense only." |
| Divides by zero in ROI or fee waiver | "If totalExpense = 0, return roi as null. If feeWaiverTarget = 0, return progress = 0. Never divide by zero." |
| Builds entire Dashboard in one step | "Stop. Only build [specific sub-phase]. We will add charts in the next step." |
| Mixes AUTH_SECRET and NEXTAUTH_SECRET | "Use NEXTAUTH_SECRET and NEXTAUTH_URL everywhere. Remove any reference to AUTH_SECRET." |
| GoalContribution type includes ADJUSTMENT | "Remove ADJUSTMENT from ContributionType. MVP only has CONTRIBUTION and WITHDRAWAL." |
