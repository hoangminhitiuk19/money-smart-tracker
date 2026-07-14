\# Money Quality Tracker — Project Context



\## Stack

\- Next.js 14 App Router, TypeScript, Tailwind CSS

\- Prisma + PostgreSQL

\- NextAuth v4 (credentials provider)

\- Zod, React Hook Form, Recharts, Vitest



\## Environment Variables

Always use: DATABASE\_URL, NEXTAUTH\_SECRET, NEXTAUTH\_URL

Never use: AUTH\_SECRET, AUTH\_URL



\## Completed Phases

\- Phase 0: Project setup

\- Phase 1: Full Prisma schema (all models, enums, relations)

\- Phase 2: Auth (NextAuth v4, credentials, bcryptjs, requireAuth())

\- Phase 3: Categories CRUD with default quality rating + seeding

\- Phase 4: Accounts \& Wallets CRUD with calculateTrackedBalance()

\- Phase 5: Financial Projects basic CRUD with calculateProjectSummary()

\- Phase 6: Transactions — all 5 types, from/to model, server actions,

&#x20;          list page with search/filter, add/edit form

\- Phase 7: Credit card pure functions (calculateCreditCardState,

&#x20;          calculateFeeWaiverState) + Vitest tests

\- Phase 8: Credit card detail page, debt/credit display,

&#x20;          annual fee section, fee waiver progress

\- Phase 9: Saving Goals CRUD, GoalContribution (CONTRIBUTION/WITHDRAWAL),

&#x20;          over-contribution prevention, calculateGoalProgress()

\- Phase 10: Renewals — all 7 actions, calculateNextDueDate(), tests

\- Phase 11: Reports — 10 report views, calculation functions, data loaders

\- Phase 12: Search and CSV export

\- Phase 13: Activity Log page

\- Phase 14: Core logic tests

\- Phase 15: Final checks



\## Design System

components/ui/ has:

&#x20; Card, Badge, Button, PageHeader, StatCard, EmptyState, LoadingSkeleton

Sidebar: slate-900, Inter font, mobile hamburger



\## Non-Negotiable Rules

1\. userId ALWAYS from session via requireAuth() — never from client input

2\. ALL queries must be scoped by userId

3\. ALL referenced foreign keys must be ownership-checked

4\. Use fromMoneySourceId / toMoneySourceId — never moneySourceId

5\. Pure calculation functions go in lib/calc/ — no DB calls inside them

6\. ActivityLog must be written inside every mutation server action

7\. Use components/ui/ for all UI — no raw divs where components exist

8\. Amount must always be positive — direction encoded in transaction type



\## Key Calculation Rules

\- Tracked balance = openingBalance + INCOME to + TRANSFER to + REFUND to

&#x20; - EXPENSE from - TRANSFER from + ADJ INCREASE - ADJ DECREASE

\- Credit card expense: use cardCredit first before adding to debt

\- Payment overflow: if payment > debt, excess goes to cardCredit

\- Refund to card: reduce debt first, overflow goes to cardCredit

\- Fee waiver = eligible expenses minus linked refunds

\- Goal progress = CONTRIBUTION total - WITHDRAWAL total

\- Project ROI = profit / expense \* 100, null if expense = 0

