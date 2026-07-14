# Money Quality Tracker — Product Specification v4 (Final)

---

## Table of Contents

1. [Overview & Positioning](#1-overview--positioning)
2. [Target Users](#2-target-users)
3. [Technical Stack](#3-technical-stack)
4. [Modules List](#4-modules-list)
5. [Authentication & Security](#5-authentication--security)
6. [Transaction Model](#6-transaction-model)
7. [Spending Quality Rating](#7-spending-quality-rating)
8. [Categories](#8-categories)
9. [Saving Goals & Contributions](#9-saving-goals--contributions)
10. [Financial Projects](#10-financial-projects)
11. [Accounts & Wallets](#11-accounts--wallets)
12. [Credit Card Tracking](#12-credit-card-tracking)
13. [Annual Fee & Waiver Tracking](#13-annual-fee--waiver-tracking)
14. [Renewals / Recurring Payments](#14-renewals--recurring-payments)
15. [Dashboard](#15-dashboard)
16. [Reports](#16-reports)
17. [Search](#17-search)
18. [CSV Export](#18-csv-export)
19. [Receipt Upload Placeholder](#19-receipt-upload-placeholder)
20. [Activity Log](#20-activity-log)
21. [Settings](#21-settings)
22. [Core Calculation Rules](#22-core-calculation-rules)
23. [Data Model Summary](#23-data-model-summary)
24. [MVP Scope](#24-mvp-scope)
25. [Future Features](#25-future-features)
26. [Pages List](#26-pages-list)
27. [UX Requirements](#27-ux-requirements)
28. [Automated Test Requirements](#28-automated-test-requirements)
29. [Manual QA Checklist](#29-manual-qa-checklist)
30. [Deployment Requirements](#30-deployment-requirements)
31. [Known MVP Limitations](#31-known-mvp-limitations)
32. [Success Criteria](#32-success-criteria)

---

## 1. Overview & Positioning

**Money Quality Tracker** is a personal finance web application that helps
users track income, expenses, saving goals, financial projects, accounts,
wallets, credit cards, and recurring payments.

Most personal finance apps answer:

> "How much money did I spend?"

This app also answers:

> "Was that spending worth it?"

**Product message:**

> "Track not only where your money goes, but whether it was worth it."

The app helps users understand:

- How much money came in and went out
- How much was saved and at what rate
- Which expenses were valuable vs wasteful
- Which goals are progressing
- Which projects are profitable or losing money
- Which credit card debts are still unpaid
- How close they are to waiving a card annual fee
- Which subscriptions need attention

---

## 2. Target Users

- Young professionals managing salary, spending, and saving goals
- People saving for marriage, travel, education, or emergency funds
- People using multiple banks, e-wallets, and credit cards
- People who want to track credit card fee waiver progress
- People managing subscriptions and recurring expenses
- People running small financial projects or side businesses
- People who want to reflect on whether spending was useful or wasteful

---

## 3. Technical Stack

| Layer | Technology |
|---|---|
| Frontend & Backend | Next.js App Router |
| Language | TypeScript |
| Styling | Tailwind CSS |
| ORM | Prisma |
| Database | PostgreSQL |
| Validation | Zod |
| Forms | React Hook Form |
| Charts | Recharts |
| Auth | NextAuth.js (credentials provider) |
| Tests | Vitest |
| Deployment | Vercel or Node-compatible platform |

### Environment Variables

Use these exact names everywhere — in `.env.example`, in code, and in all
prompts. Never mix naming conventions.

```
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

---

## 4. Modules List

1. Authentication
2. Dashboard
3. Transactions
4. Spending Quality Rating
5. Categories
6. Saving Goals & Goal Contributions
7. Financial Projects
8. Accounts & Wallets
9. Credit Card Tracking
10. Annual Fee & Fee Waiver Tracking
11. Renewals / Recurring Payments
12. Reports
13. Search
14. CSV Export
15. Receipt Upload Placeholder
16. Activity Log / Audit Trail
17. Settings
18. Security & Privacy

---

## 5. Authentication & Security

### 5.1 Auth Requirements

- Users must be able to register, log in, and log out.
- Protected pages must redirect unauthenticated users to `/login`.
- Every server action and API route must read the current user from the
  authenticated session only.
- The app must **never trust `userId` from client input** (body, query params,
  or headers).
- Every private query must be scoped by authenticated `userId`.
- Every update/delete must verify record ownership before executing.
- All referenced related records (category, money source, project, goal,
  renewal) must also pass an ownership check.

### 5.2 What Must Never Be Stored

- Full card number
- CVV / CVC
- PIN
- OTP
- Internet banking password or credentials

Allowed card identification: nickname, provider name, last 4 digits,
display identifier.

### 5.3 Cross-User Access — Prohibited Actions

A user must never be able to:

- Read, edit, or delete another user's records of any type
- Link their transaction to another user's goal, project, category, money
  source, or renewal
- Export another user's data
- View another user's dashboard or reports

### 5.4 Additional Security Measures

- Rate limiting on login, register, and mutation-heavy endpoints
- Upload endpoints must enforce file size and MIME type limits
- All secrets in environment variables only — never committed to the repo
- Error messages must not expose internal details or stack traces

---

## 6. Transaction Model

### 6.1 Design Philosophy

Transactions are the foundation of the application. Every financial event is
a transaction.

**Core rule:** All transactions use a consistent directional money-flow shape:

- `fromMoneySourceId` — where money comes from (null if external / not applicable)
- `toMoneySourceId` — where money goes to (null if external / not applicable)

There is no ambiguous single `moneySourceId`. This makes balance calculations,
reports, transfers, refunds, and credit card logic consistent.

---

### 6.2 Transaction Types

#### INCOME

Money received from outside the tracked system.

Examples: Salary, bonus, freelance, gift, investment return, business revenue.

| Field | Value |
|---|---|
| fromMoneySourceId | null |
| toMoneySourceId | receiving account or wallet (required) |

Effect:
- Increases total income
- Increases tracked balance of `toMoneySourceId`

```
Example:
Type: INCOME | From: null | To: BIDV Bank | Amount: 30,000,000 VND
→ BIDV tracked balance +30,000,000
→ Total income +30,000,000
```

---

#### EXPENSE

Money spent by the user.

Examples: Food, transport, education, health, shopping, subscriptions,
credit card purchases, annual fees.

| Field | Value |
|---|---|
| fromMoneySourceId | paying account, wallet, or card (required) |
| toMoneySourceId | null |

Effect:
- Increases total expense
- Decreases tracked balance of `fromMoneySourceId`
- If `fromMoneySourceId` is a CREDIT_CARD, applies the card credit priority
  rule before increasing tracked outstanding debt (see section 12.2)

```
Example A — no card credit:
Type: EXPENSE | From: VIB Credit Card | To: null | Amount: 10,000,000 VND
→ Total expense +10,000,000
→ VIB tracked outstanding debt +10,000,000

Example B — card credit covers expense fully:
Card credit: 1,000,000 | Expense: 300,000
→ Total expense +300,000
→ Card credit: 700,000 | Debt: unchanged

Example C — card credit partially covers expense:
Card credit: 500,000 | Expense: 800,000
→ Total expense +800,000
→ Card credit: 0 | Debt: +300,000
```

---

#### TRANSFER

Moving money between two tracked money sources.

Examples: Bank to e-wallet, bank to credit card payment, cash withdrawal,
moving salary to savings account.

| Field | Value |
|---|---|
| fromMoneySourceId | source account (required) |
| toMoneySourceId | destination account (required, must differ from `from`) |

Effect:
- Does NOT count as income
- Does NOT count as expense
- Decreases tracked balance of `fromMoneySourceId`
- If `toMoneySourceId` is a CREDIT_CARD: decreases tracked outstanding debt
  (see credit card payment overflow rule in section 12.3)
- If `toMoneySourceId` is NOT a CREDIT_CARD: increases tracked balance of
  `toMoneySourceId`

```
Critical example — Credit Card Payment:
Type: TRANSFER | From: BIDV Bank | To: VIB Credit Card | Amount: 3,000,000 VND
→ BIDV tracked balance -3,000,000
→ VIB tracked outstanding debt -3,000,000
→ Total income: no change
→ Total expense: no change
```

---

#### REFUND

Money returned to the user for a previous expense.

Examples: Returned product, cancelled service, overcharged bill.

| Field | Value |
|---|---|
| fromMoneySourceId | null |
| toMoneySourceId | refund destination account or card (required) |
| relatedTransactionId | should link to original expense where possible |

Effect:
- Does NOT count as normal income
- Reduces effective expense in reports when linked to original transaction
- If destination is a normal (non-card) source: increases tracked balance
- If destination is a CREDIT_CARD: follows the credit card refund state machine
  (see section 12.4)

```
Example — Refund to bank account:
Type: REFUND | From: null | To: BIDV Bank | Amount: 300,000 VND
→ BIDV tracked balance +300,000
→ Total income: no change
```

---

#### ADJUSTMENT

Used when the user manually corrects tracked data to match reality.

Examples: Missed transaction, reconciling app balance with bank balance,
correcting a card debt value.

| Field | Value |
|---|---|
| adjustedMoneySourceId | the source being corrected (required) |
| adjustmentDirection | INCREASE or DECREASE (required) |
| fromMoneySourceId | null (not used for adjustment) |
| toMoneySourceId | null (not used for adjustment) |

Effect:
- `INCREASE`: adds `amount` to tracked balance of `adjustedMoneySourceId`
- `DECREASE`: subtracts `amount` from tracked balance of `adjustedMoneySourceId`
- Does NOT count as income
- Does NOT count as expense
- Must be clearly labeled as ADJUSTMENT in all reports and the activity log

For CREDIT_CARD sources, the user must also choose what to adjust via
`adjustmentTarget`:
- `CREDIT_CARD_DEBT` — adjusts tracked outstanding debt
- `CARD_CREDIT` — adjusts tracked card credit balance

Default `adjustmentTarget` to `CREDIT_CARD_DEBT`. Allow the user to switch
to `CARD_CREDIT` via a toggle.

For non-credit-card sources, `adjustmentTarget` is not used —
`adjustedMoneySourceId` + `adjustmentDirection` is sufficient.

UI requirement for all adjustments:
- Show: which source, direction (increase/decrease), amount, reason/note
- Show helper text: "This corrects your tracked balance. It does not count
  as income or expense."

---

### 6.3 Transaction Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Always from session — never from client |
| type | enum | INCOME, EXPENSE, TRANSFER, REFUND, ADJUSTMENT |
| amount | decimal | Must be positive |
| currency | string | Default: VND |
| title | string | Required |
| description | string? | Optional note |
| transactionDate | date | Required |
| categoryId | string? | Must belong to same user |
| qualityRating | enum? | S, A, B, C, D — for EXPENSE only |
| fromMoneySourceId | string? | Must belong to same user |
| toMoneySourceId | string? | Must belong to same user |
| adjustedMoneySourceId | string? | ADJUSTMENT only — must belong to same user |
| adjustmentDirection | enum? | INCREASE, DECREASE — ADJUSTMENT only |
| adjustmentTarget | enum? | CREDIT_CARD_DEBT, CARD_CREDIT — ADJUSTMENT on card only |
| projectId | string? | Must belong to same user |
| relatedTransactionId | string? | REFUND linking to original expense |
| countTowardFeeWaiver | boolean | See rule in section 6.4 |
| recurringPaymentId | string? | If created from a renewal |
| isInstallmentRelated | boolean | Default false |
| createdAt | datetime | Auto |
| updatedAt | datetime | Auto |

---

### 6.4 Validation Rules

| Type | fromMoneySourceId | toMoneySourceId | Other required |
|---|---|---|---|
| INCOME | null | required | — |
| EXPENSE | required | null | — |
| TRANSFER | required | required, ≠ from | — |
| REFUND | null | required | — |
| ADJUSTMENT | null | null | adjustedMoneySourceId, adjustmentDirection |

Additional rules:
- `amount` must be positive (direction is encoded in type + direction field)
- TRANSFER: `fromMoneySourceId` ≠ `toMoneySourceId`
- `qualityRating` is only valid when `type = EXPENSE`; must be null for all other types
- `relatedTransactionId` for REFUND must point to an EXPENSE transaction owned by
  the same user (reject if it points to INCOME, TRANSFER, or another user's record)
- `annualFeeWaiverSpendTarget` must be positive when `annualFeeWaiverEnabled = true`
- Fee waiver progress returns 0 if `annualFeeWaiverSpendTarget` is null or 0
- `billingCycleDay` and `paymentDueDay` must be between 1 and 31
- `cardLastFourDigits` must contain only digit characters (0–9)
- Date filter `endDate` is inclusive at the UI level; implement as `< endDate + 1 day`
  in database queries
- User must own all referenced records: category, money sources, project,
  recurringPayment, relatedTransaction

---

### 6.5 countTowardFeeWaiver Default Rule

The field is `false` globally. When a transaction is created or edited, apply
this logic to pre-fill the value:

```
if type == EXPENSE
   AND fromMoneySourceId points to a CREDIT_CARD money source:
     pre-fill countTowardFeeWaiver = true

else:
     countTowardFeeWaiver = false
```

Exceptions that stay `false` even for credit card expenses:
- Card fees, interest, cash advance, wallet top-up transactions

The user can always manually override the pre-filled value.

---

## 7. Spending Quality Rating

### 7.1 Rating Scale

| Rating | Meaning |
|---|---|
| S | Excellent use of money |
| A | Good and useful |
| B | Acceptable |
| C | Questionable or avoidable |
| D | Wasteful or regret spending |

Only EXPENSE transactions need quality ratings.
INCOME, TRANSFER, REFUND, ADJUSTMENT do not use this field.

### 7.2 Examples

| Rating | Examples |
|---|---|
| S | Career course, health treatment, emergency medical, critical work equipment |
| A | Useful book, healthy food, planned travel, necessary transport |
| B | Normal daily spending, reasonable shopping, acceptable entertainment |
| C | Avoidable food delivery, unplanned shopping, low-value subscription |
| D | Regret purchase, impulse buy, unused product or service |

### 7.3 Reporting Definitions

- **High-quality spending:** S + A expenses
- **Low-quality spending:** C + D expenses
- Dashboard shows: quality breakdown chart, high-quality %, low-quality total

**UX note:** The rating is for reflection, not judgment. A large expense can
be S-rated if it genuinely serves a life goal.

---

## 8. Categories

### 8.1 Category Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Owner |
| name | string | Required |
| type | enum | INCOME, EXPENSE, BOTH, TRANSFER, OTHER |
| color | string? | Optional hex color |
| icon | string? | Optional icon identifier |
| defaultQualityRating | enum? | S, A, B, C, D |
| isDefault | boolean | Whether it's a seeded default |
| createdAt | datetime | Auto |
| updatedAt | datetime | Auto |

### 8.2 Default Quality Rating Behavior

When a user creates an EXPENSE and selects a category with a
`defaultQualityRating`, the quality rating field is pre-filled.
The user can always override it. This reduces per-transaction rating effort.

Suggested defaults:

| Category | Default Rating |
|---|---|
| Education | A |
| Health | A |
| Investment | A |
| Food | B |
| Drink | B |
| Transport | B |
| Entertainment | B |
| Housing | B |
| Shopping | C |
| Subscription | C |
| Annual Fee | C |
| Other | B |

### 8.3 Built-in Seeded Categories

Salary (INCOME), Food (EXPENSE), Drink (EXPENSE), Education (EXPENSE),
Health (EXPENSE), Transport (EXPENSE), Housing (EXPENSE), Shopping (EXPENSE),
Entertainment (EXPENSE), Subscription (EXPENSE), Investment (EXPENSE),
Side Business (BOTH), Credit Card Payment (TRANSFER), Annual Fee (EXPENSE),
Refund (OTHER), Other (BOTH).

All categories are scoped to the authenticated user.
Users can create, edit, and delete categories including defaults.

---

## 9. Saving Goals & Contributions

### 9.1 Saving Goals

#### Goal Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Owner |
| name | string | Required |
| targetAmount | decimal | Required |
| currency | string | Default: VND |
| deadline | date? | Optional target date |
| description | string? | Optional |
| status | enum | ACTIVE, COMPLETED, PAUSED |
| createdAt | datetime | Auto |
| updatedAt | datetime | Auto |

#### Goal Progress Calculation

```
Net contributed = SUM(CONTRIBUTION amounts) - SUM(WITHDRAWAL amounts)
Progress %      = Net contributed / targetAmount × 100
Remaining       = MAX(0, targetAmount - Net contributed)
```

---

### 9.2 Goal Contributions

GoalContribution is flexible — contributions can come from a specific income
transaction or from existing savings in any money source.

#### GoalContribution Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Owner |
| savingGoalId | string | Must belong to same user |
| transactionId | string? | Optional link to income transaction |
| fromMoneySourceId | string? | Optional link to money source |
| amount | decimal | Must be positive |
| type | enum | CONTRIBUTION, WITHDRAWAL |
| isManualAdjustment | boolean | Default false — bypasses over-contribution check |
| note | string? | Optional |
| contributionDate | date | Required |
| createdAt | datetime | Auto |
| updatedAt | datetime | Auto |

#### Over-Contribution Rule

When `transactionId` is set AND `isManualAdjustment = false`:

```
existing = SUM of all contributions linked to this transactionId
if existing + new amount > transaction.amount:
  → return error: "Total contributions to this transaction exceed its amount.
     Enable manual adjustment to override."
```

When `isManualAdjustment = true`: skip the check.
When `transactionId = null` (contributing from savings): skip the check.

#### Ownership Rules

All of the following must belong to the same authenticated user:
- `savingGoalId`
- `transactionId` (if provided)
- `fromMoneySourceId` (if provided)

---

## 10. Financial Projects

### 10.1 Project Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Owner |
| name | string | Required |
| description | string? | Optional |
| status | enum | ACTIVE, COMPLETED, PAUSED |
| createdAt | datetime | Auto |
| updatedAt | datetime | Auto |

### 10.2 Project Summary Calculations

```
Total project income  = SUM(INCOME transactions where projectId = this)
Total project expense = SUM(EXPENSE transactions where projectId = this)
Profit                = Total project income - Total project expense
ROI                   = (Profit / Total project expense) × 100
                        → display "N/A" if Total project expense = 0
```

### 10.3 Example

```
Project: Drink Investment
- Buy fruit:   EXPENSE  500,000 VND
- Buy cups:    EXPENSE  100,000 VND
- Sell drinks: INCOME   900,000 VND

Total expense: 600,000 | Total income: 900,000
Profit: 300,000 | ROI: 50%
```

---

## 11. Accounts & Wallets

### 11.1 MoneySource Types

| Type | Examples |
|---|---|
| CASH | Physical cash |
| BANK_ACCOUNT | BIDV, Techcombank |
| CREDIT_CARD | VIB, Sacombank credit cards |
| DEBIT_CARD | ATM debit card |
| E_WALLET | Momo, ZaloPay, ShopeePay |
| INVESTMENT | Stock portfolio, investment account |
| OTHER | Any other source |

### 11.2 MoneySource Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Owner |
| name | string | Required |
| type | enum | See types above |
| providerName | string? | e.g. "VIB", "Momo" |
| displayIdentifier | string? | e.g. "ending 1234" |
| currency | string | Default: VND |
| openingBalance | decimal | Default 0 |
| description | string? | Optional notes |
| isActive | boolean | Default true |
| createdAt | datetime | Auto |
| updatedAt | datetime | Auto |

Credit card sources also include the fields in section 12.1.

### 11.3 Tracked Balance Formula (Non-Credit-Card Sources)

```
Tracked balance =
  openingBalance
  + SUM(INCOME   where toMoneySourceId   = this source)
  + SUM(TRANSFER where toMoneySourceId   = this source)
  + SUM(REFUND   where toMoneySourceId   = this source)   ← includes refunds
  - SUM(EXPENSE  where fromMoneySourceId = this source)
  - SUM(TRANSFER where fromMoneySourceId = this source)
  + SUM(ADJUSTMENT INCREASE on this source)
  - SUM(ADJUSTMENT DECREASE on this source)
```

**This formula does not apply to CREDIT_CARD sources.**
Credit cards use the tracked debt formula in section 12.2.

All displayed balances must be labeled:

> "Tracked in this app — may not match your official bank balance"

---

## 12. Credit Card Tracking

### 12.1 Additional Credit Card Fields (on MoneySource)

| Field | Type | Notes |
|---|---|---|
| cardLastFourDigits | string? | 2–6 digits only, no other characters |
| cardNetwork | enum? | VISA, MASTERCARD, JCB, NAPAS, AMEX, OTHER |
| openedDate | date? | When card was opened |
| creditLimit | decimal? | Non-negative |
| initialOutstandingDebt | decimal | Default 0 |
| initialCardCredit | decimal | Default 0 |
| billingCycleDay | int? | 1–31 |
| paymentDueDay | int? | 1–31 |

### 12.2 Card Credit Priority Rule (Expense on Credit Card)

When an EXPENSE is paid with a credit card, card credit is consumed first
before adding to debt:

```
if cardCredit > 0 AND expense ≤ cardCredit:
  cardCredit -= expense
  debt unchanged

if cardCredit > 0 AND expense > cardCredit:
  debt += expense - cardCredit
  cardCredit = 0

if cardCredit = 0:
  debt += expense
```

This rule applies every time an EXPENSE transaction uses a CREDIT_CARD as
`fromMoneySourceId`. Process in chronological order.

### 12.3 Tracked Outstanding Debt Formula

```
Tracked outstanding debt =
  initialOutstandingDebt
  + SUM(expense amounts added to debt — after card credit priority rule)
  - payments applied (see payment overflow rule below)
  - refunds applied to debt (see refund state machine below)
  + SUM(ADJUSTMENT INCREASE where adjustmentTarget = CREDIT_CARD_DEBT)
  - SUM(ADJUSTMENT DECREASE where adjustmentTarget = CREDIT_CARD_DEBT)

Tracked available credit =
  creditLimit - tracked outstanding debt
  (floor at 0 — never show negative available credit)

Tracked card credit =
  initialCardCredit
  + SUM(refund overflow amounts — see refund state machine)
  + SUM(payment overflow amounts — see payment overflow rule)
  - SUM(card credit consumed by expense — see card credit priority rule)
  + SUM(ADJUSTMENT INCREASE where adjustmentTarget = CARD_CREDIT)
  - SUM(ADJUSTMENT DECREASE where adjustmentTarget = CARD_CREDIT)
```

### 12.4 Credit Card Payment Overflow Rule

When a TRANSFER targets a CREDIT_CARD (`toMoneySourceId = card`):

```
if payment amount ≤ tracked outstanding debt:
  tracked outstanding debt -= payment amount
  (no change to card credit)

if payment amount > tracked outstanding debt:
  overflow = payment amount - tracked outstanding debt
  tracked outstanding debt = 0
  tracked card credit += overflow
```

Example:
```
Tracked debt: 1,000,000 VND
Payment:      2,000,000 VND
→ Tracked debt: 0
→ Card credit: +1,000,000 VND
```

### 12.5 Credit Card Refund State Machine

When a REFUND targets a CREDIT_CARD (`toMoneySourceId = card`):

```
if tracked outstanding debt > 0 AND refund ≤ tracked outstanding debt:
  tracked outstanding debt -= refund amount

if tracked outstanding debt > 0 AND refund > tracked outstanding debt:
  overflow = refund amount - tracked outstanding debt
  tracked outstanding debt = 0
  tracked card credit += overflow

if tracked outstanding debt = 0:
  tracked card credit += refund amount
```

Examples:
```
Case A — debt exists, refund is smaller:
  Debt: 7,000,000 | Refund: 2,000,000
  → Debt: 5,000,000 | Credit: 0

Case B — debt exists, refund is larger:
  Debt: 1,000,000 | Refund: 2,000,000
  → Debt: 0 | Credit: +1,000,000

Case C — debt already zero:
  Debt: 0 | Refund: 2,000,000
  → Debt: 0 | Credit: +2,000,000
```

### 12.6 Card Credit Display Rule

Card credit must always be displayed separately from the official credit limit.

```
Credit limit:     20,000,000 VND  ← official, only changes if user updates it
Card credit:       2,000,000 VND  ← shown separately
Available credit: 20,000,000 VND  ← assuming 0 debt

NEVER display: "Credit limit: 22,000,000 VND"
```

### 12.7 MVP Credit Card View

The card detail page must show:

- Credit limit
- Tracked outstanding debt
- Tracked available credit
- Tracked card credit (shown only if > 0)
- Payments made this month
- Expenses made this month

All labeled: *"Tracked estimate from your records"*

---

## 13. Annual Fee & Waiver Tracking

### 13.1 Annual Fee Fields (on MoneySource)

| Field | Type | Notes |
|---|---|---|
| hasAnnualFee | boolean | Default false |
| annualFeeAmount | decimal? | Required if hasAnnualFee |
| annualFeeCurrency | string | Default VND |
| annualFeeChargeDate | date? | Next expected charge date |
| annualFeeFrequency | enum | YEARLY, MONTHLY, QUARTERLY, CUSTOM |
| firstYearFeeWaived | boolean | Default false |
| freeYearsCount | int? | Number of free years from open date |
| feeWaivedUntilDate | date? | If bank confirmed waiver until this date |

Dashboard shows upcoming fee reminders 30 days before `annualFeeChargeDate`.

### 13.2 Fee Waiver Fields (on MoneySource)

| Field | Type | Notes |
|---|---|---|
| annualFeeWaiverEnabled | boolean | Default false |
| annualFeeWaiverSpendTarget | decimal? | Required if waiver enabled |
| annualFeeWaiverPeriod | enum | YEARLY, MONTHLY, STATEMENT_CYCLE, CUSTOM |
| waiverPeriodStartDate | date? | Start of current waiver period |
| waiverPeriodEndDate | date? | End of current waiver period |
| annualFeeWaiverNote | string? | Manual notes on bank-specific rules |

### 13.3 Fee Waiver Calculation

```
Eligible spending =
  SUM(EXPENSE where fromMoneySourceId = this card
      AND countTowardFeeWaiver = true
      AND transactionDate within waiver period)
  - SUM(REFUND amounts linked to those eligible transactions)

Progress %        = (Eligible spending / annualFeeWaiverSpendTarget) × 100
Remaining         = MAX(0, annualFeeWaiverSpendTarget - Eligible spending)
```

**Key rule:** Refunds linked to fee-waiver-eligible transactions reduce
eligible spending. Always subtract them before calculating progress.

### 13.4 countTowardFeeWaiver Defaults

| Transaction | Default |
|---|---|
| EXPENSE from credit card | `true` (pre-filled, user can override) |
| Card fees, interest, cash advance, wallet top-up | `false` |
| TRANSFER (including card payment) | `false` |
| REFUND, INCOME, ADJUSTMENT | `false` |

Banks have different rules — users can always override manually.

### 13.5 Example Display

```
VIB Credit Card ending 1234
Waiver target:             100,000,000 VND/year
Tracked eligible spending:  42,000,000 VND
Remaining:                  58,000,000 VND
Progress:                   42%

⚠ "Tracked in this app — verify with your bank"
```

---

## 14. Renewals / Recurring Payments

### 14.1 Renewal Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Owner |
| fromMoneySourceId | string? | Paying source |
| toMoneySourceId | string? | Receiving source (for recurring transfers) |
| categoryId | string? | Optional |
| projectId | string? | Optional |
| title | string | Required |
| description | string? | Optional |
| amount | decimal | Required |
| currency | string | Default VND |
| transactionType | enum | INCOME, EXPENSE, TRANSFER |
| qualityRating | enum? | S, A, B, C, D |
| countTowardFeeWaiver | boolean | Follows credit card expense rule |
| frequency | enum | DAILY, WEEKLY, MONTHLY, YEARLY, CUSTOM |
| intervalCount | int | Default 1 |
| nextDueDate | date | Required |
| reminderDaysBefore | int | Default 3 |
| autoCreateTransaction | boolean | Default false |
| status | enum | ACTIVE, PAUSED, CANCELLED |
| lastGeneratedDate | date? | Set when "mark as paid" is used |
| createdAt | datetime | Auto |
| updatedAt | datetime | Auto |

### 14.2 Actions

| Action | Server behavior |
|---|---|
| Mark as paid | Create transaction from renewal fields; advance `nextDueDate` one cycle; set `lastGeneratedDate` = today; log RENEWAL_MARKED_PAID |
| Skip this cycle | Advance `nextDueDate` one cycle; no transaction; log RENEWAL_SKIPPED |
| Pause | Set `status = PAUSED`; no date change; log RENEWAL_PAUSED |
| Resume | Set `status = ACTIVE`; no date change; log RENEWAL_RESUMED |
| Cancel | Set `status = CANCELLED`; log RENEWAL_CANCELLED |
| Delete | Hard delete after confirmation dialog; log RENEWAL_DELETED |
| Edit | Update any field; log RENEWAL_UPDATED |

**Overdue renewal rule:** Mark as paid and skip always advance `nextDueDate`
by exactly one cycle from the current `nextDueDate`, even if the result is
still in the past. The app shows it as overdue again until the user acts again.
Do not auto-advance multiple cycles in MVP.

### 14.3 Next Due Date Calculation

```
nextDueDate after action =
  current nextDueDate + (intervalCount × frequency unit)

DAILY:   + intervalCount days
WEEKLY:  + intervalCount × 7 days
MONTHLY: + intervalCount months
YEARLY:  + intervalCount years
CUSTOM:  treat same as DAILY for MVP
```

### 14.4 Upcoming Renewals Logic

Show on dashboard where:
```
status = ACTIVE
AND nextDueDate ≤ today + reminderDaysBefore days
```

Sorted soonest first.

---

## 15. Dashboard

Users can filter all dashboard data by: This Week, This Month, This Year,
Custom Date Range. All values are scoped to the authenticated user AND the
selected period (based on `transactionDate`).

### 15.1 Summary Cards

1. Total income
2. Total expense
3. Net savings
4. Saving rate
5. High-quality spending %
6. Low-quality spending amount
7. Estimated net position (labeled clearly — see section 15.3)
8. Active saving goal progress (top goals)
9. Active project summary
10. Spending by account/wallet
11. Credit card tracked debt + available credit (per active card)
12. Annual fee waiver progress (per waiver-enabled card)
13. Upcoming renewals list
14. Upcoming card fee reminders (within 30 days)

### 15.2 Charts

1. Income vs expense over time (line or bar)
2. Expense by category (pie or bar)
3. Spending quality breakdown (pie or stacked bar)
4. Spending by account/wallet (bar)
5. Saving goal progress (horizontal progress bars)
6. Project profit/loss (bar)

### 15.3 Estimated Net Position

```
Estimated net position =
  SUM(tracked balances of CASH, BANK_ACCOUNT, DEBIT_CARD, E_WALLET, INVESTMENT)
  - SUM(tracked outstanding debt of all CREDIT_CARD sources)
```

Must be labeled:

> "Estimated from your records — not official bank data"

---

## 16. Reports

### 16.1 Raw vs Effective Expense

Reports must be consistent about which expense figure they use:

**Raw expense** = SUM(EXPENSE transactions)
**Effective expense** = SUM(EXPENSE) - SUM(REFUND amounts linked to those expenses)

| Report | Uses |
|---|---|
| Dashboard total expense card | Raw expense |
| Income vs expense over time | Effective expense |
| Expense by category | Effective expense (refund reduces its original category) |
| Spending quality breakdown | Effective expense |
| Project profit/loss | Effective expense (refund reduces project cost) |
| Spending by account/wallet | Effective expense |
| Net savings / saving rate | Raw expense (simpler, labeled as such) |

**Rule for linking refunds:** A refund reduces effective expense only when
`relatedTransactionId` links it to the original EXPENSE. Unlinked refunds
are not subtracted from any specific category or project.

### 16.2 Report Views (10 required)

1. Income vs expense over time
2. Expense by category
3. Spending quality breakdown
4. Saving goal progress
5. Project profit/loss
6. Spending by account/wallet
7. Credit card tracked debt history
8. Annual fee waiver progress (per card)
9. Upcoming renewals total (monthly view)
10. Recurring expenses per month

### 16.3 Filters (available on all reports)

Date range, transaction type, category, quality rating, money source,
project, saving goal.

---

## 17. Search

Part of MVP. Users accumulate thousands of transactions — search is essential.

### 17.1 Capabilities

- Free-text search on title and description
- Filter by: category, money source, project, transaction type, date range,
  quality rating
- Results paginated (page size 20)
- URL reflects current filters (shareable within the user's session)
- All results scoped to authenticated user

---

## 18. CSV Export

Part of MVP. Financial data must be portable and user-owned.

### 18.1 Export Columns

Date, Type, Title, Amount, Currency, Category, Quality Rating,
From Source, To Source, Project, Description, Count Toward Fee Waiver,
Created At.

### 18.2 Rules

- Authenticated user only — never export another user's data
- Export action logged to ActivityLog with `rowCount` in metadata
- Future: export goals, contributions, projects, accounts, renewals,
  full backup

---

## 19. Receipt Upload Placeholder

### MVP Behavior

1. User uploads or selects a receipt image
2. App shows a manual entry form (no OCR)
3. User manually enters: amount, date, merchant, category, quality rating,
   money source
4. User creates a transaction from entered values

### Future Behavior

- OCR extracts text from receipt image
- AI suggests transaction fields
- User reviews and confirms — app never auto-saves without confirmation

---

## 20. Activity Log

### 20.1 ActivityLog Fields

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key |
| userId | string | Owner |
| action | string | See actions below |
| entityType | string | e.g. "Transaction", "MoneySource" |
| entityId | string? | ID of affected record |
| metadata | json? | Structured shape per action |
| createdAt | datetime | Auto |

### 20.2 Tracked Actions & Metadata Shapes

| Action | metadata shape |
|---|---|
| TRANSACTION_CREATED | `{ amount, type, title, fromSourceId, toSourceId }` |
| TRANSACTION_UPDATED | `{ changedFields: { field: [oldValue, newValue] } }` |
| TRANSACTION_DELETED | `{ amount, type, title }` |
| GOAL_CONTRIBUTION_CREATED | `{ goalId, amount, type }` |
| GOAL_CONTRIBUTION_UPDATED | `{ changedFields: { field: [oldValue, newValue] } }` |
| MONEY_SOURCE_CREATED | `{ name, type }` |
| MONEY_SOURCE_UPDATED | `{ changedFields: { field: [oldValue, newValue] } }` |
| CREDIT_CARD_UPDATED | `{ changedFields: { field: [oldValue, newValue] } }` |
| RENEWAL_MARKED_PAID | `{ renewalId, amount, newNextDueDate }` |
| RENEWAL_SKIPPED | `{ renewalId, newNextDueDate }` |
| RENEWAL_PAUSED | `{ renewalId }` |
| RENEWAL_RESUMED | `{ renewalId }` |
| RENEWAL_CANCELLED | `{ renewalId }` |
| RENEWAL_DELETED | `{ renewalId, title }` |
| RENEWAL_UPDATED | `{ renewalId, changedFields: { field: [oldValue, newValue] } }` |
| CSV_EXPORTED | `{ exportedAt, rowCount }` |

### 20.3 Pagination & Retention

- Paginated at 50 entries per page
- MVP retains 90 days of log entries
- ActivityLog entries are written server-side as a side effect of mutations —
  never as a separate client call

---

## 21. Settings

| Setting | Notes |
|---|---|
| Default currency | Default: VND |
| Date format | e.g. DD/MM/YYYY |
| Number format | e.g. 1,000,000 |
| Default dashboard period | Month, Week, Year |
| Notification preference | Placeholder |
| Profile / account info | Name, email |
| Data export | CSV export shortcut |
| App theme | Placeholder — light/dark |

---

## 22. Core Calculation Rules

All formulas in one place for reference. These are the source of truth.

```
── Income & Expense ──────────────────────────────────────────────────────────

Total income =
  SUM(amount of INCOME transactions in period)

Total expense =
  SUM(amount of EXPENSE transactions in period)

Effective expense (reports) =
  Total expense - SUM(REFUND amounts linked to EXPENSE transactions in period)

Net savings =
  Total income - Total expense

Saving rate =
  (Net savings / Total income) × 100
  → 0 if Total income = 0

── Spending Quality ──────────────────────────────────────────────────────────

High-quality % =
  SUM(S + A rated EXPENSE) / SUM(all rated EXPENSE) × 100
  → 0 if no rated expenses

Low-quality amount =
  SUM(C + D rated EXPENSE)

── Goals ─────────────────────────────────────────────────────────────────────

Goal progress % =
  Net contributions / targetAmount × 100

Net contributions =
  SUM(CONTRIBUTION amounts) - SUM(WITHDRAWAL amounts)

── Projects ──────────────────────────────────────────────────────────────────

Project profit =
  SUM(INCOME linked to project) - SUM(EXPENSE linked to project)

Project ROI =
  (Project profit / SUM(EXPENSE linked to project)) × 100
  → "N/A" if project expense = 0

── Account Balance (non-credit-card) ─────────────────────────────────────────

Tracked balance =
  openingBalance
  + SUM(INCOME   where toMoneySourceId   = source)
  + SUM(TRANSFER where toMoneySourceId   = source)
  + SUM(REFUND   where toMoneySourceId   = source)
  - SUM(EXPENSE  where fromMoneySourceId = source)
  - SUM(TRANSFER where fromMoneySourceId = source)
  + SUM(ADJUSTMENT INCREASE on source)
  - SUM(ADJUSTMENT DECREASE on source)

── Credit Card ───────────────────────────────────────────────────────────────

Card credit priority rule (applied per EXPENSE, chronological order):
  if cardCredit > 0 and expense ≤ cardCredit: cardCredit -= expense
  if cardCredit > 0 and expense > cardCredit: debt += expense - cardCredit; cardCredit = 0
  if cardCredit = 0:                          debt += expense

Tracked outstanding debt =
  initialOutstandingDebt
  + SUM(expense amounts added to debt after card credit priority rule)
  - SUM(payments applied to debt — see payment overflow rule)
  - SUM(refund amounts applied to debt — see refund state machine)
  + SUM(ADJUSTMENT INCREASE on CREDIT_CARD_DEBT)
  - SUM(ADJUSTMENT DECREASE on CREDIT_CARD_DEBT)

Tracked available credit =
  MAX(0, creditLimit - tracked outstanding debt)

Tracked card credit =
  initialCardCredit
  + SUM(payment overflow amounts)
  + SUM(refund overflow amounts)
  - SUM(card credit consumed by expenses — card credit priority rule)
  + SUM(ADJUSTMENT INCREASE on CARD_CREDIT)
  - SUM(ADJUSTMENT DECREASE on CARD_CREDIT)

Payment overflow rule:
  if payment ≤ debt:  debt -= payment
  if payment > debt:  overflow = payment - debt; debt = 0; credit += overflow

Refund state machine (to credit card):
  if debt > 0 and refund ≤ debt:  debt -= refund
  if debt > 0 and refund > debt:  overflow = refund - debt; debt = 0; credit += overflow
  if debt = 0:                    credit += refund

── Fee Waiver ────────────────────────────────────────────────────────────────

Eligible spending =
  SUM(EXPENSE from card where countTowardFeeWaiver = true and within period)
  - SUM(REFUND amounts linked to those eligible transactions)

Fee waiver progress % =
  (Eligible spending / annualFeeWaiverSpendTarget) × 100

Fee waiver remaining =
  MAX(0, annualFeeWaiverSpendTarget - Eligible spending)

── Net Position ──────────────────────────────────────────────────────────────

Estimated net position =
  SUM(tracked balances of CASH, BANK_ACCOUNT, DEBIT_CARD, E_WALLET, INVESTMENT)
  - SUM(tracked outstanding debt of CREDIT_CARD sources)
```

---

## 23. Data Model Summary

### Models

| Model | Purpose |
|---|---|
| User | Auth and ownership anchor |
| Category | Transaction categorization with default quality |
| Transaction | All financial events (all 5 types) |
| SavingGoal | Life savings targets |
| GoalContribution | Flexible contributions and withdrawals per goal |
| FinancialProject | Grouped income/expense activities |
| MoneySource | All accounts, wallets, and cards |
| RecurringPayment | Subscription and renewal tracker |
| ReceiptUpload | Placeholder for future OCR |
| ActivityLog | Audit trail of important mutations |
| *(future)* InstallmentPlan | Monthly payment schedules |
| *(future)* CreditCardDebtItem | Purchase-level debt tracking |

### Key Relationships

- User → many of everything
- Transaction → one User, optional Category, optional Project,
  optional from/to MoneySource, optional adjustedMoneySource
- GoalContribution → one SavingGoal, optional Transaction,
  optional MoneySource
- RecurringPayment → optional from/to MoneySource, optional Category,
  optional Project
- MoneySource → many Transactions (as from, to, or adjusted source)

---

## 24. MVP Scope

### Included in MVP

1. Register / login / logout
2. Protected routes with full ownership enforcement
3. Dashboard with period filter
4. Manual transaction CRUD — all 5 types with correct from/to model
5. ADJUSTMENT type with `adjustmentDirection` and `adjustedMoneySourceId`
6. Transaction quality rating
7. Default quality rating per category
8. Categories CRUD
9. Saving goals CRUD
10. Goal contributions (CONTRIBUTION, WITHDRAWAL)
11. Over-contribution prevention with `isManualAdjustment` override
12. Financial projects CRUD with profit/loss and ROI
13. Accounts & wallets CRUD — all source types
14. Credit card fields, tracked debt, available credit, card credit
15. Credit card payment overflow rule
16. Credit card refund state machine
17. Annual fee reminders
18. Annual fee waiver progress (with refund-adjusted formula)
19. Renewals: create, mark as paid, skip, pause, cancel
20. Transaction search and filter (paginated)
21. CSV export (transactions, scoped to user)
22. All 10 report views
23. Receipt upload placeholder
24. Activity log (major mutations, paginated, 90-day retention)
25. Estimated net position widget (labeled)
26. README and setup documentation
27. Automated Vitest tests for all core financial logic
28. Manual QA checklist

### Not in MVP

- Real bank integration
- Real OCR
- Push notifications (email or mobile)
- Installment plan module
- Purchase-level card debt tracking
- Shared multi-user expenses
- Budget planning
- Recurring transaction detection
- App store deployment

---

## 25. Future Features

1. Real OCR receipt scanning
2. AI transaction categorization
3. AI spending quality suggestions
4. Bank / CSV import
5. Full data backup and export
6. Budget planning per category
7. Installment plan module
8. Credit card statement cycle tracking
9. Minimum payment reminders
10. Purchase-level card debt tracking
11. Subscription cancellation suggestions
12. Recurring transaction detection
13. Shared goals for couples/family
14. Multi-currency exchange support
15. PWA install support
16. Notification emails and mobile push
17. Advanced reconciliation mode
18. Full net worth history

---

## 26. Pages List

### Public

1. Landing page
2. Login page
3. Register page

### Protected

1. Dashboard
2. Transactions (list + search + filter)
3. Add / Edit Transaction
4. Categories
5. Saving Goals
6. Saving Goal Detail + Contributions
7. Projects
8. Project Detail
9. Accounts & Wallets
10. Account / Wallet Detail
11. Credit Card Detail
12. Renewals
13. Reports
14. Receipt Upload
15. Activity Log
16. Settings

---

## 27. UX Requirements

### Principles

- Clean, simple, modern
- Mobile-first — usable from a phone browser
- Easy manual input with sensible defaults
- Never judgmental — spending quality is for reflection, not guilt
- All tracked/estimated figures clearly labeled

### Key UI Elements

- Summary cards with clear labels
- Paginated data tables
- Responsive forms with validation messages
- Filters, search input, and sort controls
- Recharts charts and horizontal progress bars
- Empty states with actionable prompts
- Loading skeleton states (not spinner-only)
- Error messages that are safe and user-friendly
- Confirmation dialogs for all destructive actions

---

## 28. Automated Test Requirements

All tests use pure functions with mock data — no database required.

1.  `calculateTrackedBalance` — income increases balance
2.  `calculateTrackedBalance` — expense decreases balance
3.  `calculateTrackedBalance` — REFUND increases balance
4.  `calculateTrackedBalance` — transfer in/out correct
5.  `calculateTrackedBalance` — adjustment INCREASE and DECREASE
6.  `calculateCreditCardState` — expense with no card credit increases debt
7.  `calculateCreditCardState` — expense fully covered by card credit, debt unchanged
8.  `calculateCreditCardState` — expense partially covered by card credit
9.  `calculateCreditCardState` — payment reduces debt
10. `calculateCreditCardState` — payment overflow → card credit
11. `calculateCreditCardState` — refund reduces debt (Case A)
12. `calculateCreditCardState` — refund overflows debt (Case B)
13. `calculateCreditCardState` — refund when debt is zero (Case C)
14. `calculateGoalProgress` — contributions and withdrawals
15. `goalOverContributionPrevention` — blocked when transaction link exists
16. `goalOverContributionPrevention` — bypassed when isManualAdjustment = true
17. `goalOverContributionPrevention` — no check when transactionId is null
18. `calculateProjectSummary` — profit and ROI
19. `calculateProjectSummary` — zero expense returns ROI as null / "N/A"
20. `calculateFeeWaiverProgress` — basic progress
21. `calculateFeeWaiverProgress` — refund reduces eligible spending
22. `calculateFeeWaiverProgress` — non-eligible transactions excluded
23. `calculateFeeWaiverProgress` — target zero or null returns progress 0
24. `calculateFeeWaiverRemaining` — floors at 0 when eligible exceeds target
25. `calculateNextDueDate` — DAILY, WEEKLY, MONTHLY, YEARLY
26. `calculateNextDueDate` — intervalCount > 1
27. `calculateNextDueDate` — CUSTOM behaves as DAILY
28. `validateTransactionFields` — each type's from/to rules
29. `validateTransactionFields` — qualityRating rejected on non-EXPENSE
30. `countTowardFeeWaiverDefault` — pre-fill true for credit card expense
31. `countTowardFeeWaiverDefault` — stays false for TRANSFER / INCOME / REFUND
32. `adjustmentDirectionEffect` — INCREASE adds to balance
33. `adjustmentDirectionEffect` — DECREASE subtracts from balance
34. `calculateNetSavings` — normal case
35. `calculateNetSavings` — zero income → saving rate is 0, not error
36. `calculateSpendingQualityBreakdown` — correct grouping
37. `calculateEstimatedNetPosition` — sums assets minus card debt
38. `ownershipGuard` — passes when userId matches
39. `ownershipGuard` — throws when userId does not match
40. `csvExportScope` — only returns current user's transactions

---

## 29. Manual QA Checklist

### Auth
- [ ] Register new user
- [ ] Login
- [ ] Logout
- [ ] Protected route redirects unauthenticated user to login

### Transactions — All Types
- [ ] Create INCOME (to account)
- [ ] Create EXPENSE (from account, quality rating)
- [ ] Create EXPENSE (from credit card) → tracked debt increases
- [ ] Create EXPENSE (from credit card when card credit exists) → card credit consumed first, debt increases only by remainder
- [ ] Create TRANSFER (bank to bank)
- [ ] Create TRANSFER (bank to credit card) → tracked debt decreases, income unchanged
- [ ] Create TRANSFER (payment that exceeds debt) → debt = 0, card credit appears
- [ ] Create REFUND (to bank account) → bank balance increases
- [ ] Create REFUND (to credit card, debt > 0) → debt decreases
- [ ] Create REFUND (to credit card, debt = 0) → card credit increases
- [ ] Create ADJUSTMENT INCREASE → source balance increases
- [ ] Create ADJUSTMENT DECREASE → source balance decreases
- [ ] Create ADJUSTMENT on credit card (CREDIT_CARD_DEBT) → debt changes
- [ ] Category default quality rating pre-fills correctly
- [ ] Edit transaction
- [ ] Delete transaction with confirmation dialog
- [ ] Filter transactions (type / date / category / quality / source)
- [ ] Search by title and note
- [ ] Export CSV → columns correct, only current user's data

### Categories
- [ ] Create with default quality rating
- [ ] Edit
- [ ] Delete

### Saving Goals
- [ ] Create goal
- [ ] Contribute from income transaction
- [ ] Contribute from existing savings (no transaction link)
- [ ] Over-contribution blocked
- [ ] Over-contribution allowed with isManualAdjustment
- [ ] Withdrawal reduces progress
- [ ] Progress % and remaining displayed correctly

### Projects
- [ ] Create project
- [ ] Link transactions to project
- [ ] Project profit/loss and ROI correct
- [ ] ROI shows "N/A" when no expense

### Accounts & Wallets
- [ ] Create bank account, e-wallet, cash, credit card
- [ ] Tracked balance formula correct (with refunds included)
- [ ] Estimated net position correct

### Credit Card
- [ ] Annual fee reminder shows on dashboard
- [ ] Fee waiver progress updates on eligible expense
- [ ] Fee waiver decreases when linked refund added
- [ ] Transaction marked countTowardFeeWaiver = false is excluded
- [ ] Card credit shown separately from credit limit

### Renewals
- [ ] Create renewal
- [ ] Mark as paid → transaction created, next due date updated
- [ ] Skip → next due date updated, no transaction
- [ ] Pause → disappears from upcoming
- [ ] Cancel → disappears from upcoming

### Dashboard & Reports
- [ ] All summary cards show correct values
- [ ] Period filter works
- [ ] Estimated net position labeled correctly
- [ ] All 10 report views render
- [ ] Charts render without errors

### Activity Log
- [ ] Major mutations appear in log
- [ ] Pagination works

### Security
- [ ] User A cannot access User B's data in any way
- [ ] CSV export only contains current user's data

### Mobile
- [ ] All pages usable on phone browser
- [ ] Forms usable on mobile keyboard

---

## 30. Deployment Requirements

### Checklist

- [ ] Production PostgreSQL database provisioned
- [ ] All env vars set: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- [ ] `prisma migrate deploy` run (not `prisma db push`)
- [ ] `next build` passes without errors
- [ ] Auth tested: register, login, logout, session persistence
- [ ] DB writes tested: create transaction, create goal
- [ ] Protected routes tested after logout
- [ ] Dashboard and reports tested after creating data
- [ ] CSV export tested
- [ ] User data isolation confirmed (two test accounts)
- [ ] README includes: setup steps, env vars, migration command

### Production Rules

- Never commit `.env` or any file with real secrets
- Never seed real personal data
- Never store full card numbers
- Use `migrate deploy` in production — never `db push`

---

## 31. Known MVP Limitations

1. No direct bank integration — all data is user-entered
2. Tracked balances are estimates — may not match official bank statements
3. Credit card debt is a tracked estimate, not an official statement balance
4. Receipt OCR is a placeholder — no automatic extraction
5. Users must manually reconcile missing or incorrect transactions
6. Installment tracking is deferred to a future release
7. In-app notifications only — no email or push
8. Fee waiver progress depends on user-entered and manually flagged transactions
9. Bank-specific fee waiver rules may require manual adjustment
10. Shared household / couple features not included
11. Budget planning not included
12. Recurring transaction detection not included

---

## 32. Success Criteria

The application is successful when a user can:

1. Track all income and expenses manually
2. Understand whether spending was valuable through quality ratings
3. Benefit from category default ratings without rating every transaction
4. Save toward multiple life goals simultaneously
5. Contribute to goals from income or existing savings flexibly
6. Track financial projects with profit/loss and ROI visibility
7. Manage all accounts, wallets, and credit cards in one place
8. Track credit card spending, payments, debt, and card credit accurately
9. See upcoming annual fee reminders
10. Monitor credit card fee waiver progress
11. Stay aware of all subscriptions and renewals
12. Search past transactions efficiently
13. Export transaction data to CSV at any time
14. View meaningful dashboard insights and reports
15. Use the app confidently knowing personal financial data is private and secure
