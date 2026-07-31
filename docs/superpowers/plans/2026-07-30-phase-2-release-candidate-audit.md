# Phase 2 Release-Candidate Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and, where necessary, restore the complete MVP financial backend before deploying a release candidate to Vercel Preview.

**Architecture:** A deterministic two-user reference ledger drives pure Decimal-safe calculations, real PostgreSQL server-action workflows, ownership tests, dashboard/report/CSV reconciliation, and manual Preview acceptance. Work advances through traceability, domain fixes, integration evidence, a backend release gate, and only then Vercel Preview.

**Tech Stack:** Node.js 22, Next.js 15.5.21 App Router, React 19, TypeScript, Prisma 6/PostgreSQL, NextAuth v4, Zod, Vitest, Neon, Vercel.

## Global Constraints

- Read `money-quality-tracker-spec-v4.md` §§6–22 and §§28–32 plus the relevant `codex-prompting-guide-v2.md` phase before every task.
- Work on one task at a time; discuss any new specification contradiction and never expand scope without approval.
- Use only `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`; never use `AUTH_SECRET` or `AUTH_URL`.
- Read the authenticated user only through `requireAuth()` and scope every private record and referenced foreign key by that user.
- Use `fromMoneySourceId`, `toMoneySourceId`, and `adjustedMoneySourceId`; never introduce an ambiguous `moneySourceId`.
- Preserve positive amounts and encode direction through transaction type and `adjustmentDirection`.
- Use Prisma Decimal-compatible arithmetic internally. Do not convert money to JavaScript `number` before the final presentation adapter.
- Same-day financial events order by `transactionDate`, then `createdAt`, then `id`.
- Dashboard period filters affect period analysis; current-state cards use complete history or their own active cycle.
- Database integration tests use only the disposable Neon database, unique run identifiers, and bounded fixture cleanup.
- Add a failing regression test before every behavior fix and end every task with focused tests, the normal suite, typecheck, lint, and `git diff --check`.
- Keep `tests/integration/**` opt-in from `npm run test:run`.
- Do not deploy Vercel Preview until Task 16 closes the backend release gate.

---

### Task 1: Establish Traceability and the Financial Integration Harness

**Files:**
- Create: `docs/quality/phase-2-traceability.md`
- Create: `tests/integration/helpers/audit-context.ts`
- Create: `tests/integration/helpers/reference-ledger.ts`
- Create: `tests/integration/audit-harness.integration.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces:
  - `createAuditContext(runId: string): Promise<AuditContext>`
  - `cleanupAuditContext(context: AuditContext): Promise<void>`
  - `REFERENCE_DATES`, `REFERENCE_AMOUNTS`, and literal expected ledger values.
- `AuditContext` exposes only User A/User B IDs and emails without passwords.
  Later domain suites create their own owned records through the public server
  actions and retain those returned IDs locally.

- [ ] **Step 1: Write the traceability matrix**

Create a table with columns:

```markdown
| Rule | Implementation | Unit evidence | DB evidence | Status | Disposition |
| --- | --- | --- | --- | --- | --- |
| §6.4 inclusive end date | `lib/date-range.ts` | `tests/date-range.test.ts` | `tests/integration/date-ranges.integration.test.ts` | Missing | Task 3 |
```

Populate every rule in specification §§6–22 and every required test in §28.
Use `Covered`, `Missing`, `Failing`, or `Ambiguous`; do not mark a row covered
from a test name without inspecting its assertions.

- [ ] **Step 2: Write a failing bounded-cleanup harness test**

```ts
it("creates two isolated audit users and removes only this run", async () => {
  const first = await createAuditContext(`audit-a-${randomUUID()}`);
  const second = await createAuditContext(`audit-b-${randomUUID()}`);

  await cleanupAuditContext(first);

  await expect(prisma.user.findUnique({ where: { id: first.userA.id } }))
    .resolves.toBeNull();
  await expect(prisma.user.findUnique({ where: { id: second.userA.id } }))
    .resolves.not.toBeNull();

  await cleanupAuditContext(second);
});
```

Create the helper modules with exported stubs that throw
`new Error("Not implemented")` so Vitest can collect and execute the test.

- [ ] **Step 3: Run the integration test to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/audit-harness.integration.test.ts'
```

Expected: FAIL at the deliberate `Not implemented` boundary. A module-resolution
or test-collection error is not acceptable RED evidence.

- [ ] **Step 4: Implement the fixture boundary**

Use a run-specific email prefix and delete only the two recorded user IDs:

```ts
export type AuditContext = {
  runId: string;
  userA: { id: string; email: string };
  userB: { id: string; email: string };
};

export async function cleanupAuditContext(context: AuditContext) {
  await prisma.user.deleteMany({
    where: { id: { in: [context.userA.id, context.userB.id] } }
  });
}
```

`createAuditContext` creates both users inside one Prisma transaction with
synthetic password hashes and no personal data. `reference-ledger.ts` records
the fixed 2026 UTC dates and literal expected values approved in the design.

- [ ] **Step 5: Correct contributor documentation**

Change the stale `AGENTS.md` architecture reference from Next.js 14 to Next.js
15 and add the opt-in integration command:

```bash
npm run test:integration
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/audit-harness.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add AGENTS.md docs/quality tests/integration
git commit -m "test: establish financial audit harness"
```

---

### Task 2: Introduce Decimal-Safe Money Arithmetic

**Files:**
- Create: `lib/money.ts`
- Create: `tests/money.test.ts`
- Modify: `lib/calc/balance.ts`
- Modify: `lib/calc/credit-card.ts`
- Modify: `lib/calc/goals.ts`
- Modify: `lib/calc/projects.ts`
- Modify: `lib/calc/dashboard.ts`
- Modify: `lib/calc/reports.ts`
- Modify: `lib/actions/dashboard.ts`
- Modify: `lib/actions/reports.ts`
- Modify: `app/(protected)/accounts/page.tsx`
- Modify: `app/(protected)/accounts/[id]/page.tsx`
- Modify: `app/(protected)/dashboard/page.tsx`
- Modify: `app/(protected)/goals/page.tsx`
- Modify: `app/(protected)/goals/[id]/page.tsx`
- Modify: `app/(protected)/projects/page.tsx`
- Modify: `app/(protected)/reports/page.tsx`
- Modify: `components/reports/ReportsClient.tsx`
- Modify: `components/ui/ProgressBar.tsx`
- Modify: `tests/balance.test.ts`
- Modify: `tests/credit-card.test.ts`
- Modify: `tests/goals.test.ts`
- Modify: `tests/projects.test.ts`
- Modify: `tests/dashboard.test.ts`
- Modify: `tests/reports.test.ts`

**Interfaces:**
- Produces:

```ts
export type DecimalInput = Prisma.Decimal.Value;
export function decimal(value: DecimalInput): Prisma.Decimal;
export function money(value: DecimalInput): Prisma.Decimal;
export function sumMoney(values: readonly DecimalInput[]): Prisma.Decimal;
export function percent(
  numerator: DecimalInput,
  denominator: DecimalInput
): Prisma.Decimal;
export function moneyText(value: DecimalInput): string;
export function presentationNumber(value: DecimalInput): number;
```

- Money-returning calculation fields become `Prisma.Decimal`; ratio fields
  become `Prisma.Decimal | null`. UI adapters may call `presentationNumber`
  only at chart or formatter boundaries.

- [ ] **Step 1: Write precision regression tests**

```ts
it("preserves cents above Number.MAX_SAFE_INTEGER", () => {
  expect(
    money("90071992547409.99").plus(money("0.01")).toFixed(2)
  ).toBe("90071992547410.00");
});

it("adds decimal cents exactly", () => {
  expect(sumMoney(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
});
```

Add domain assertions such as:

```ts
expect(calculateTrackedBalance(source, transactions).toFixed(2)).toBe("0.30");
expect(calculateProjectSummary(rows).profit.toFixed(2)).toBe("0.20");
```

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/money.test.ts tests/balance.test.ts tests/credit-card.test.ts tests/goals.test.ts tests/projects.test.ts'
```

Expected: FAIL because current calculations return binary floating-point
numbers and `lib/money.ts` does not exist.

- [ ] **Step 3: Implement the Decimal boundary**

Use `Prisma.Decimal` without rounding intermediate results:

```ts
export function money(value: DecimalInput) {
  return new Prisma.Decimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP
  );
}

export function percent(numerator: DecimalInput, denominator: DecimalInput) {
  const divisor = decimal(denominator);
  return divisor.isZero()
    ? decimal(0)
    : decimal(numerator).div(divisor).mul(100);
}
```

Refactor reducers to start from `decimal(0)` and use `.plus()`/`.minus()`.
Do not call `.toNumber()` inside `lib/calc/**`.

- [ ] **Step 4: Adapt tests and presentation boundaries**

Compare currency with `.toFixed(2)` and percentages with `.toDecimalPlaces(8)`.
Update every calculation consumer named above in the same task so the branch
typechecks after the return-type change. Where Recharts or a progress element
requires a number, convert immediately before constructing presentation data
and retain the exact string for labels.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/money.test.ts tests/balance.test.ts tests/credit-card.test.ts tests/goals.test.ts tests/projects.test.ts tests/dashboard.test.ts tests/reports.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/money.ts lib/calc lib/actions app components tests
git commit -m "fix: preserve decimal financial precision"
```

---

### Task 3: Standardize Date-Only and Inclusive Range Semantics

**Files:**
- Create: `lib/date-range.ts`
- Create: `tests/date-range.test.ts`
- Modify: `lib/actions/transactions.ts`
- Modify: `lib/actions/dashboard.ts`
- Modify: `lib/actions/reports.ts`
- Modify: `app/api/export/transactions/route.ts`
- Modify: `tests/transactions.actions.test.ts`
- Modify: `tests/dashboard.test.ts`
- Modify: `tests/reports.test.ts`
- Create: `tests/integration/date-ranges.integration.test.ts`

**Interfaces:**
- Produces:

```ts
export function startOfDate(input: Date | string): Date;
export function exclusiveDayAfter(input: Date | string): Date;
export function transactionDateRange(
  start?: Date | string,
  inclusiveEnd?: Date | string
): { gte?: Date; lt?: Date };
```

- [ ] **Step 1: Write boundary and source-filter tests**

```ts
expect(transactionDateRange("2026-07-01", "2026-07-30")).toEqual({
  gte: new Date("2026-07-01T00:00:00.000Z"),
  lt: new Date("2026-07-31T00:00:00.000Z")
});
```

The database test inserts transactions at `2026-07-30T00:00:00.000Z`,
`2026-07-30T23:59:59.999Z`, and `2026-07-31T00:00:00.000Z`; the first two
must match and the third must not. Add an ADJUSTMENT using only
`adjustedMoneySourceId` and assert the source filter returns it.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
TZ=Asia/Ho_Chi_Minh npx --yes --package=node@22 --call='npm run test:run -- tests/date-range.test.ts tests/transactions.actions.test.ts'
```

Expected: FAIL because the current query uses `lte` at the start of the chosen
end date and ignores `adjustedMoneySourceId`.

- [ ] **Step 3: Implement one shared range**

Replace every transaction date predicate with:

```ts
transactionDate: transactionDateRange(startDate, endDate)
```

Extend the money-source `OR` predicate to include:

```ts
{ adjustedMoneySourceId: filters.moneySourceId }
```

- [ ] **Step 4: Verify across timezones and the database**

Run:

```bash
TZ=UTC npx --yes --package=node@22 --call='npm run test:run -- tests/date-range.test.ts'
TZ=Asia/Ho_Chi_Minh npx --yes --package=node@22 --call='npm run test:run -- tests/date-range.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/date-ranges.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add lib/date-range.ts lib/actions app/api tests
git commit -m "fix: make financial date ranges inclusive"
```

---

### Task 4: Add Required Financial Relationships and Defaults

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260730_add_financial_audit_constraints/migration.sql`
- Modify: `lib/category-seed.ts`
- Modify: `lib/actions/categories.ts`
- Modify: `app/(protected)/categories/page.tsx`
- Modify: `tests/categories.actions.test.ts`
- Create: `tests/integration/schema-finance.integration.test.ts`

**Interfaces:**
- `Category.defaultCountTowardFeeWaiver Boolean @default(true)`.
- `Transaction.recurringPayment` becomes an optional relation with
  `onDelete: SetNull`; `RecurringPayment.generatedTransactions` is the reverse
  relation.
- Add indexes on `Transaction.recurringPaymentId` and
  `ActivityLog.createdAt`.

- [ ] **Step 1: Write schema behavior tests**

The integration test must assert:

```ts
await expect(
  prisma.transaction.create({
    data: { ...validTransaction, recurringPaymentId: "missing-renewal" }
  })
).rejects.toMatchObject({ code: "P2003" });
```

It also creates a renewal-generated transaction, deletes the renewal, and
expects the transaction to remain with `recurringPaymentId === null`.

- [ ] **Step 2: Run schema tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/schema-finance.integration.test.ts'
```

Expected: FAIL because no renewal foreign key exists.

- [ ] **Step 3: Implement schema and data migration**

Migration requirements:

```sql
ALTER TABLE "Category"
  ADD COLUMN "defaultCountTowardFeeWaiver" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Category"
SET "defaultCountTowardFeeWaiver" = false
WHERE "isDefault" = true AND lower("name") = 'annual fee';

CREATE INDEX "Transaction_recurringPaymentId_idx"
  ON "Transaction"("recurringPaymentId");
CREATE INDEX "ActivityLog_createdAt_idx"
  ON "ActivityLog"("createdAt");
```

Add the renewal foreign key with `ON DELETE SET NULL`. Update the seeded Annual
Fee category to `defaultCountTowardFeeWaiver: false`.

- [ ] **Step 4: Expose the category default**

Accept and persist the boolean in category create/update actions. Add a labeled
checkbox:

> Count credit-card expenses in this category toward fee waiver by default

The transaction-level checkbox remains the final override.

- [ ] **Step 5: Validate migration and commit**

Run:

```bash
npx --yes --package=node@22 --call='./node_modules/.bin/prisma validate'
npx --yes --package=node@22 --call='npm run prisma:deploy'
npx --yes --package=node@22 --call='./node_modules/.bin/prisma migrate status'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/schema-finance.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run -- tests/categories.actions.test.ts'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add prisma lib/category-seed.ts lib/actions/categories.ts app tests
git commit -m "feat: enforce financial audit relationships"
```

---

---

### Task 5: Make Credit-Card and Fee-Waiver Configuration Reachable

**Files:**
- Create: `lib/validation/money-source.ts`
- Create: `components/money-source-form.tsx`
- Modify: `lib/actions/money-sources.ts`
- Modify: `app/(protected)/accounts/page.tsx`
- Modify: `app/(protected)/accounts/[id]/page.tsx`
- Modify: `tests/money-sources.actions.test.ts`
- Create: `tests/integration/money-sources.integration.test.ts`

**Interfaces:**
- Produces `moneySourceSchema`, `moneySourceUpdateSchema`, and exported input
  types used by actions and the form.
- Accept every `MoneySource` field from specification §§11–13.
- Conditional validation:
  - card digits match `^\d{2,6}$`;
  - cycle and due days are integers from 1 through 31;
  - credit limit and initial debt/credit are non-negative;
  - annual fee amount/frequency/date are required when annual fees are enabled;
  - waiver target is positive and period dates are present when waiver tracking
    is enabled.

- [ ] **Step 1: Add failing action and database tests**

```ts
it("persists complete credit-card configuration", async () => {
  const result = await createMoneySource({
    name: "Audit Card",
    type: MoneySourceType.CREDIT_CARD,
    currency: "VND",
    creditLimit: "2000.00",
    initialOutstandingDebt: "300.00",
    initialCardCredit: "100.00",
    cardLastFourDigits: "1234",
    billingCycleDay: 15,
    paymentDueDay: 28,
    hasAnnualFee: true,
    annualFeeAmount: "250.00",
    annualFeeFrequency: FeeFrequency.YEARLY,
    annualFeeChargeDate: "2026-12-01",
    annualFeeWaiverEnabled: true,
    annualFeeWaiverSpendTarget: "1000.00",
    annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
    waiverPeriodStartDate: "2026-01-01",
    waiverPeriodEndDate: "2026-12-31"
  });
  expect(result).toEqual({ ok: true });
});
```

Add rejection cases for non-digit card IDs, day 0/32, negative credit values,
missing enabled annual-fee fields, and non-positive waiver targets. Each
rejection asserts zero `MoneySource` and zero `ActivityLog` writes.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/money-sources.actions.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/money-sources.integration.test.ts'
```

Expected: FAIL because current actions accept only base account fields.

- [ ] **Step 3: Implement shared validation and actions**

Use `z.coerce.number()` only for validation; pass decimal inputs to Prisma as
strings or `Prisma.Decimal`, not binary numbers. The update schema must
distinguish absent fields from explicit clearing.

- [ ] **Step 4: Build one reusable create/edit form**

Render card, fee, and waiver groups only for `CREDIT_CARD`. Use the same
component for account creation and account-detail editing. Preserve the
existing server action and ownership boundaries.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/money-sources.actions.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/money-sources.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/validation lib/actions/money-sources.ts components/money-source-form.tsx app tests
git commit -m "feat: support complete credit card configuration"
```

---

### Task 6: Complete Transaction Validation and Edit Semantics

**Files:**
- Modify: `lib/calc/transactions.ts`
- Modify: `lib/actions/transactions.ts`
- Modify: `components/transaction-form.tsx`
- Modify: `tests/transactions.test.ts`
- Modify: `tests/transactions.actions.test.ts`
- Create: `tests/integration/transactions.integration.test.ts`

**Interfaces:**
- Extend `TransactionValidationInput` with `adjustmentTarget`,
  `relatedTransactionId`, and source-type context.
- Explicit nullable update fields use `null` to clear and `undefined` to retain.
- `getCountTowardFeeWaiverDefault` consumes the selected category's
  `defaultCountTowardFeeWaiver`.

- [ ] **Step 1: Add failing field-matrix tests**

Cover:

```ts
expect(validateTransactionFields({
  type: TransactionType.REFUND,
  amount: "25.00",
  toMoneySourceId: "bank",
  relatedTransactionId: "expense"
}).ok).toBe(true);
```

Also assert:

- a refund link to INCOME, TRANSFER, REFUND, ADJUSTMENT, or another user fails;
- a link on a non-refund fails;
- card ADJUSTMENT without a target defaults to `CREDIT_CARD_DEBT`;
- non-card ADJUSTMENT clears/rejects `adjustmentTarget`;
- adjustment-only fields on non-adjustments fail;
- EXPENSE to INCOME clears stale from-source and quality fields;
- category, project, description, and refund link can be cleared.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/transactions.test.ts tests/transactions.actions.test.ts'
```

Expected: FAIL on refund type enforcement, stale update fields, and clearing.

- [ ] **Step 3: Normalize complete transaction state before validation**

Use an explicit nullable-field set:

```ts
type NullableTransactionField =
  | "categoryId"
  | "qualityRating"
  | "fromMoneySourceId"
  | "toMoneySourceId"
  | "adjustedMoneySourceId"
  | "adjustmentDirection"
  | "adjustmentTarget"
  | "projectId"
  | "relatedTransactionId"
  | "recurringPaymentId";
```

When type changes, clear fields that are invalid for the new type before
validating. FormData empty strings become `null` for nullable fields.

- [ ] **Step 4: Verify real persistence and no-write failures**

The integration suite creates all five types, verifies stored directional
fields, checks every owned reference, exercises EXPENSE → INCOME and REFUND
unlink transitions, and snapshots transaction/activity counts for rejection.

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/transactions.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add lib/calc/transactions.ts lib/actions/transactions.ts components/transaction-form.tsx tests
git commit -m "fix: enforce complete transaction semantics"
```

---

### Task 7: Reconcile Credit-Card, Fee-Waiver, and Account Projections

**Files:**
- Modify: `lib/calc/credit-card.ts`
- Modify: `lib/calc/dashboard.ts`
- Modify: `app/(protected)/accounts/page.tsx`
- Modify: `app/(protected)/accounts/[id]/page.tsx`
- Modify: `tests/credit-card.test.ts`
- Modify: `tests/dashboard.test.ts`
- Create: `tests/integration/credit-card-ledger.integration.test.ts`

**Interfaces:**
- `CreditCardTransaction` includes `createdAt` and `id`.
- `calculateCreditCardState` sorts ascending by `transactionDate`,
  `createdAt`, then `id`.
- Linked refunds reduce fee-waiver spending based on the original eligible
  expense, regardless of refund destination.
- Account list/detail never call `calculateTrackedBalance` for a credit card.

- [ ] **Step 1: Add the failing reference-card ledger**

Use the approved literal chronology and assert:

```ts
expect(state.outstandingDebt.toFixed(2)).toBe("85.00");
expect(state.cardCredit.toFixed(2)).toBe("15.00");
expect(state.availableCredit.toFixed(2)).toBe("1915.00");
expect(waiver.eligibleSpending.toFixed(2)).toBe("210.00");
expect(waiver.remaining.toFixed(2)).toBe("790.00");
```

Include a linked eligible refund deposited into a bank account and a same-day
sequence whose `createdAt` order changes the debt/credit result.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/credit-card.test.ts tests/dashboard.test.ts'
```

Expected: FAIL because refund destination is over-restricted and tie ordering
is not deterministic.

- [ ] **Step 3: Implement deterministic projection rules**

Sort a copy of the transaction list; do not mutate caller arrays. Build an
expense map for waiver eligibility and subtract every linked refund from the
eligible original expense.

- [ ] **Step 4: Correct account presentation**

For a credit card, the account list shows tracked debt as the primary tracked
metric and card credit separately when positive. Non-card sources continue to
show `calculateTrackedBalance`.

- [ ] **Step 5: Verify database reconciliation and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/credit-card-ledger.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/calc app tests
git commit -m "fix: reconcile credit card financial projections"
```

---

### Task 8: Make Goal Contributions Exact, Atomic, and Race-Safe

**Files:**
- Create: `lib/db/serializable.ts`
- Modify: `lib/calc/goals.ts`
- Modify: `lib/actions/goals.ts`
- Modify: `lib/actions/goal-contributions.ts`
- Modify: `tests/goals.test.ts`
- Modify: `tests/goal-contributions.actions.test.ts`
- Create: `tests/integration/goals.integration.test.ts`

**Interfaces:**
- Produces:

```ts
export async function runSerializable<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts?: number
): Promise<T>;
```

- Only `CONTRIBUTION` may link to an owned `INCOME` transaction.
- `WITHDRAWAL` requires `transactionId === null`.
- Manual overrides bypass their immediate ceiling but remain in later linked
  contribution totals.

- [ ] **Step 1: Write failing type and concurrency tests**

Add real-database cases:

```ts
const results = await Promise.all([
  createContribution(linkedContribution("60.00")),
  createContribution(linkedContribution("60.00"))
]);
expect(results.filter((result) => result.ok)).toHaveLength(1);
expect(await committedLinkedTotal()).toBe("60.00");
```

Test exact 200.00 remaining accepted, 200.01 rejected, manual override accepted,
later normal allocation blocked, non-INCOME link rejected, and withdrawal link
rejected. Every rejection proves no contribution and no activity row.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/goals.integration.test.ts'
```

Expected: FAIL because aggregate/check/create is not serialized and transaction
type is not verified.

- [ ] **Step 3: Implement serialized allocation**

Run reference lookup, linked aggregate, validation, contribution write, and
activity write in one serializable transaction. Retry Prisma `P2034` conflicts
up to three attempts; return the existing safe action error after exhaustion.

- [ ] **Step 4: Make goal mutations and their logs atomic**

Create/update/delete the goal and its activity row in the same Prisma
transaction. Use the transaction client for every query in that unit.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/goals.test.ts tests/goal-contributions.actions.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/goals.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/db lib/calc/goals.ts lib/actions/goals.ts lib/actions/goal-contributions.ts tests
git commit -m "fix: make goal allocations atomic"
```

---

### Task 9: Verify Project Arithmetic and Atomic Mutations

**Files:**
- Modify: `lib/calc/projects.ts`
- Modify: `lib/actions/projects.ts`
- Modify: `tests/projects.test.ts`
- Modify: `tests/projects.actions.test.ts`
- Create: `tests/integration/projects.integration.test.ts`

**Interfaces:**
- Project summary remains raw per specification §10.
- Project report remains effective-expense per §16.1.
- Project CRUD and activity logging commit or roll back together.

- [ ] **Step 1: Write failing integration and exact-money tests**

Use literal expectations:

```ts
expect(summary.totalIncome.toFixed(2)).toBe("900000.00");
expect(summary.totalExpense.toFixed(2)).toBe("600000.00");
expect(summary.profit.toFixed(2)).toBe("300000.00");
expect(summary.roi?.toFixed(2)).toBe("50.00");
```

With a linked 100000 refund, raw summary remains 300000 profit while the
effective report becomes 400000 profit and 80% ROI. Force activity creation to
fail and assert the project mutation rolls back.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/projects.integration.test.ts'
```

Expected: FAIL on atomic rollback because the domain write currently commits
before activity logging.

- [ ] **Step 3: Implement atomic project actions**

Pass one Prisma transaction client through ownership, mutation, and activity
creation. Preserve the raw/effective distinction and label it in test names and
traceability.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/projects.test.ts tests/projects.actions.test.ts tests/reports.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/projects.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/calc/projects.ts lib/actions/projects.ts tests
git commit -m "fix: make project workflows atomic"
```

---

### Task 10: Make Renewal Dates and Workflows Canonical

**Files:**
- Modify: `lib/calc/renewals.ts`
- Modify: `lib/actions/renewals.ts`
- Modify: `lib/actions/dashboard.ts`
- Modify: `tests/renewals.test.ts`
- Modify: `tests/renewals.actions.test.ts`
- Create: `tests/integration/renewals.integration.test.ts`

**Interfaces:**
- Date-only renewal math uses UTC calendar components.
- Monthly/yearly dates clamp to the last valid target-month day.
- Mark-paid and skip reject non-`ACTIVE` renewals.
- Renewal mutation and activity metadata match specification §20.2.

- [ ] **Step 1: Add timezone and workflow regression tests**

Assert that a due date of 2026-08-02 with a three-day reminder is included on
2026-07-30 in Asia/Ho_Chi_Minh. Run the same pure date cases under UTC,
Asia/Ho_Chi_Minh, and America/Los_Angeles.

The integration suite verifies mark-paid creates exactly one transaction,
advances one cycle, sets `lastGeneratedDate`, stores `recurringPaymentId`, and
writes:

```ts
{
  renewalId,
  amount: "100.00",
  newNextDueDate: "2026-08-30T00:00:00.000Z"
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
TZ=Asia/Ho_Chi_Minh npx --yes --package=node@22 --call='npm run test:run -- tests/renewals.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/renewals.integration.test.ts'
```

Expected: FAIL on timezone boundary, status enforcement, and metadata shape.

- [ ] **Step 3: Implement canonical date and status rules**

Use UTC getters/setters and a clamped month helper. Centralize the upcoming
predicate so dashboard and renewal actions cannot drift.

- [ ] **Step 4: Make renewal workflows atomic**

Keep mark-paid inside its existing transaction and place create/update/skip/
status/delete plus their activity writes inside transactions. Delete preserves
generated transactions through the Task 4 `SET NULL` relation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
TZ=UTC npx --yes --package=node@22 --call='npm run test:run -- tests/renewals.test.ts'
TZ=Asia/Ho_Chi_Minh npx --yes --package=node@22 --call='npm run test:run -- tests/renewals.test.ts'
TZ=America/Los_Angeles npx --yes --package=node@22 --call='npm run test:run -- tests/renewals.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/renewals.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/calc/renewals.ts lib/actions/renewals.ts lib/actions/dashboard.ts tests
git commit -m "fix: canonicalize renewal workflows"
```

---

### Task 11: Align Activity Metadata, Atomicity, and Retention

**Files:**
- Create: `lib/activity.ts`
- Modify: `lib/actions/transactions.ts`
- Modify: `lib/actions/money-sources.ts`
- Modify: `lib/actions/categories.ts`
- Modify: `lib/actions/goal-contributions.ts`
- Modify: `lib/actions/renewals.ts`
- Modify: `app/(protected)/activity-log/page.tsx`
- Modify: `tests/transactions.actions.test.ts`
- Modify: `tests/money-sources.actions.test.ts`
- Create: `tests/activity.test.ts`
- Create: `tests/integration/activity.integration.test.ts`

**Interfaces:**
- Produces:

```ts
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: readonly (keyof T)[]
): Record<string, [unknown, unknown]>;

export async function deleteExpiredActivity(
  db: Prisma.TransactionClient | typeof prisma,
  cutoff: Date,
  limit?: number
): Promise<number>;
```

- Exact §20.2 metadata keys are enforced with typed builders.

- [ ] **Step 1: Write failing metadata and rollback tests**

Assert exact transaction metadata:

```ts
expect(created.metadata).toEqual({
  amount: "100.00",
  type: "EXPENSE",
  title: "Audit expense",
  fromSourceId: sourceId,
  toSourceId: null
});
```

Update metadata must be:

```ts
{ changedFields: { title: ["Before", "After"] } }
```

Force `activityLog.create` to reject and assert the financial mutation rolls
back. Seed 101-day, 90-day, and current logs; bounded cleanup deletes only rows
older than 90 days and never another user's current records.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/activity.test.ts tests/transactions.actions.test.ts tests/money-sources.actions.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/activity.integration.test.ts'
```

Expected: FAIL on metadata shape, rollback, and retention.

- [ ] **Step 3: Implement typed activity builders**

Use exact keys from specification §20.2. Capture the pre-update row before the
mutation and build `changedFields` only from persisted changes.

- [ ] **Step 4: Make remaining mutation/log pairs atomic**

Place transaction, money-source, category, and remaining contribution mutation
plus activity writes in one Prisma transaction. Preserve rate-limit and
validation early exits before opening the transaction.

- [ ] **Step 5: Implement bounded retention**

Delete at most 500 expired rows ordered by `createdAt`, using the Task 4 index.
The activity page shows only records within the 90-day window even when cleanup
has not yet run.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/activity.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/activity.ts lib/actions app tests
git commit -m "fix: make activity auditing reliable"
```

---

### Task 12: Implement the Hybrid Dashboard Data Horizon

**Files:**
- Modify: `lib/actions/dashboard.ts`
- Modify: `lib/calc/dashboard.ts`
- Modify: `app/(protected)/dashboard/page.tsx`
- Modify: `tests/dashboard.test.ts`
- Create: `tests/integration/dashboard.integration.test.ts`

**Interfaces:**
- `getDashboardData(periodStart, periodEnd)` fetches:
  - `periodTransactions` for income, raw expense, savings, quality, and charts;
  - `ledgerTransactions` for balances, card state, and net position;
  - active-domain records using goal, fee-waiver, and reminder horizons.
- Net-position assets whitelist:
  `CASH`, `BANK_ACCOUNT`, `DEBIT_CARD`, `E_WALLET`, `INVESTMENT`.

- [ ] **Step 1: Write the failing historical-state test**

Seed prior-period income/card expense/payment and current-period expense. Query
the current month and assert:

```ts
expect(result.summary.totalExpense.toFixed(2)).toBe("100.00");
expect(result.netPosition.toFixed(2)).toBe("2520.00");
expect(result.cards[0].outstandingDebt.toFixed(2)).toBe("85.00");
```

Add an `OTHER` source with opening balance 999 and assert it is excluded from
net position.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/dashboard.test.ts'
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/dashboard.integration.test.ts'
```

Expected: FAIL because current state uses only period transactions and `OTHER`
is included as an asset.

- [ ] **Step 3: Separate period and ledger queries**

Execute both queries under the authenticated `userId`. Keep raw dashboard
expense and saving rate period-scoped. Calculate balances, debt, card credit,
net position, goals, fee cycles, renewals, and fee reminders from their
approved horizons.

- [ ] **Step 4: Label horizon differences**

Use concise UI notes:

- “Selected period” on income/expense/savings cards.
- “Current tracked estimate” on net position and card state.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/dashboard.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/actions/dashboard.ts lib/calc/dashboard.ts app tests
git commit -m "fix: separate dashboard period and current state"
```

---

### Task 13: Apply Complete Report Filters and Reconciliation

**Files:**
- Modify: `lib/actions/reports.ts`
- Modify: `lib/calc/reports.ts`
- Modify: `app/(protected)/reports/page.tsx`
- Modify: `components/reports/ReportsClient.tsx`
- Modify: `tests/reports.test.ts`
- Create: `tests/reports.actions.test.ts`
- Create: `tests/integration/reports.integration.test.ts`

**Interfaces:**
- Produces:

```ts
export type ReportFilters = {
  startDate?: Date | string;
  endDate?: Date | string;
  type?: TransactionType;
  categoryId?: string;
  qualityRating?: QualityRating;
  moneySourceId?: string;
  projectId?: string;
  savingGoalId?: string;
  groupBy?: ReportGroupBy;
};
```

- Transaction reports apply saving-goal filtering through
  `goalContributions.some.savingGoalId`.
- Non-transaction reports accept the same filter contract and apply only
  meaningful dimensions while retaining the selected filter state in the URL.

- [ ] **Step 1: Write failing action-filter tests**

Assert a combined filter produces:

```ts
{
  userId,
  type: TransactionType.EXPENSE,
  categoryId,
  qualityRating: QualityRating.A,
  projectId,
  OR: [
    { fromMoneySourceId: sourceId },
    { toMoneySourceId: sourceId },
    { adjustedMoneySourceId: sourceId }
  ],
  goalContributions: { some: { savingGoalId } },
  transactionDate: {
    gte: new Date("2026-07-01T00:00:00.000Z"),
    lt: new Date("2026-08-01T00:00:00.000Z")
  }
}
```

Add tests for all ten report views and raw-versus-effective expense.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/reports.test.ts tests/reports.actions.test.ts'
```

Expected: FAIL because only date/group filters exist.

- [ ] **Step 3: Implement one validated filter predicate**

Build one user-scoped Prisma predicate and reuse it for every transaction-based
loader. Do not accept `userId` from the filter. Add filter controls for type,
category, quality, source, project, and goal while preserving URL state.

- [ ] **Step 4: Reconcile all report outputs**

The integration suite uses the reference ledger and literal expectations:

- income `1000.00`;
- raw expense `440.00`;
- effective expense `350.00`;
- project raw/effective distinction;
- fee waiver `210.00`;
- card debt `85.00`;
- all User B sentinel values absent.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/reports.integration.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/actions/reports.ts lib/calc/reports.ts app components tests
git commit -m "fix: complete report filtering and reconciliation"
```

---

### Task 14: Apply Persisted User Settings

**Files:**
- Create: `lib/user-format.ts`
- Create: `tests/user-format.test.ts`
- Modify: `lib/actions/settings.ts`
- Modify: `app/(protected)/dashboard/page.tsx`
- Modify: `app/(protected)/accounts/page.tsx`
- Modify: `app/(protected)/accounts/[id]/page.tsx`
- Modify: `app/(protected)/goals/page.tsx`
- Modify: `app/(protected)/projects/page.tsx`
- Modify: `app/(protected)/renewals/page.tsx`
- Modify: `app/(protected)/reports/page.tsx`
- Modify: `app/(protected)/transactions/page.tsx`
- Modify: `components/settings-form.tsx`
- Modify: `tests/settings.actions.test.ts`

**Interfaces:**
- Produces:

```ts
export type UserFormatSettings = {
  defaultCurrency: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  numberFormat: "1,000,000" | "1.000.000";
};

export function formatUserMoney(
  value: DecimalInput,
  currency: string,
  settings: UserFormatSettings
): string;

export function formatUserDate(
  value: Date | string,
  settings: UserFormatSettings
): string;
```

- Dashboard defaults to the persisted `Week`, `Month`, or `Year` when the URL
  does not specify a period.

- [ ] **Step 1: Write failing formatting/default tests**

```ts
expect(formatUserDate("2026-07-30", ddMmSettings)).toBe("30/07/2026");
expect(formatUserMoney("1000000", "VND", dotSettings)).toContain("1.000.000");
```

Mock settings with `defaultDashboardPeriod: "Year"` and assert a missing URL
period queries the year range rather than month.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/user-format.test.ts tests/settings.actions.test.ts'
```

Expected: FAIL because formatters and dashboard defaults are hard-coded.

- [ ] **Step 3: Implement formatting and replace hard-coded boundaries**

Load settings once per protected page boundary and use the shared formatter.
Keep email read-only and profile/password updates scoped to the authenticated
user.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/user-format.test.ts tests/settings.actions.test.ts tests/dashboard.test.ts'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add lib/user-format.ts lib/actions/settings.ts app components tests
git commit -m "fix: apply persisted display settings"
```

---

### Task 15: Prove Two-User Isolation and Full-Ledger Reconciliation

**Files:**
- Create: `tests/integration/ownership.integration.test.ts`
- Create: `tests/integration/reference-ledger.integration.test.ts`
- Create: `tests/integration/export.integration.test.ts`
- Modify: `tests/integration/helpers/reference-ledger.ts`
- Modify: `docs/quality/phase-2-traceability.md`

**Interfaces:**
- Consumes Task 1's two-user context and literal reference-ledger values.
- Produces the complete backend evidence used by the release gate.

- [ ] **Step 1: Add cross-user action attempts**

As User B, attempt to get, reference, update, delete, mark, skip, pause, resume,
cancel, report on, and export User A's category, sources, transaction, project,
goal, contribution, and renewal. Every attempt must return safe not-found/error
behavior, and this snapshot must remain unchanged:

```ts
expect(await snapshotUserState(userA.id)).toEqual(before);
```

- [ ] **Step 2: Add complete ledger reconciliation**

Enter the approved ledger through server actions, then assert literal values:

```ts
expect(bankBalance.toFixed(2)).toBe("1455.00");
expect(cashBalance.toFixed(2)).toBe("100.00");
expect(walletBalance.toFixed(2)).toBe("250.00");
expect(cardState.outstandingDebt.toFixed(2)).toBe("85.00");
expect(cardState.cardCredit.toFixed(2)).toBe("15.00");
expect(netPosition.toFixed(2)).toBe("2520.00");
expect(waiver.eligibleSpending.toFixed(2)).toBe("210.00");
```

Assert dashboard, reports, CSV row count/columns, and activity events reconcile
to the same fixture. Edit and delete selected entries, then assert every
dependent projection updates consistently.

- [ ] **Step 3: Run integration tests to verify failures are meaningful**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration -- tests/integration/ownership.integration.test.ts tests/integration/reference-ledger.integration.test.ts tests/integration/export.integration.test.ts'
```

Any failure must be classified against the traceability matrix. Add a focused
regression test and minimal fix in the owning production file before rerunning
this task; do not weaken literal expectations.

- [ ] **Step 4: Close traceability entries**

Every row must link to passing unit or database evidence. A remaining
`Missing`, `Failing`, or `Ambiguous` row blocks Task 16.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx --yes --package=node@22 --call='npm run test:integration'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run lint'
git diff --check
```

Commit:

```bash
git add tests/integration docs/quality/phase-2-traceability.md
git commit -m "test: prove financial backend reconciliation"
```

---

### Task 16: Close the Backend Release Gate

**Files:**
- Create: `docs/quality/phase-2-backend-audit-report.md`
- Modify: `docs/quality/phase-2-traceability.md`
- Modify: `README.md`

**Interfaces:**
- Produces an evidence report with command, timestamp, result, test count,
  database migration state, review findings, and deferred non-blockers.

- [ ] **Step 1: Run a clean Node 22 release gate**

Run sequentially:

```bash
npx --yes --package=node@22 --call='npm ci'
npx --yes --package=node@22 --call='./node_modules/.bin/prisma validate'
npx --yes --package=node@22 --call='npm run prisma:deploy'
npx --yes --package=node@22 --call='./node_modules/.bin/prisma migrate status'
npx --yes --package=node@22 --call='npm run lint'
npx --yes --package=node@22 --call='npm run typecheck'
npx --yes --package=node@22 --call='npm run test:run'
npx --yes --package=node@22 --call='npm run test:integration'
npx --yes --package=node@22 --call='npm audit --omit=dev --audit-level=high'
npx --yes --package=node@22 --call='npm run build'
git diff --check
git status --short
```

- [ ] **Step 2: Obtain a whole-branch review**

The reviewer checks specification traceability, Decimal safety, transaction
matrix, concurrency, atomicity, ownership, migration safety, current-versus-
period horizons, all ten reports, CSV, and test independence. Critical or
Important findings return to one fix/re-review loop.

- [ ] **Step 3: Write the backend audit report**

Record exact evidence. Development-only advisories remain listed separately
from the production release audit. Do not mark Vercel or manual QA complete.

- [ ] **Step 4: Commit**

```bash
git add docs/quality README.md
git commit -m "docs: close phase 2 backend release gate"
```

---

### Task 17: Complete MVP UX Blockers and Vercel Preview Acceptance

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `components/destructive-action-button.tsx`
- Create: `tests/destructive-action-button.test.tsx`
- Modify: `app/(protected)/accounts/page.tsx`
- Modify: `app/(protected)/categories/page.tsx`
- Modify: `app/(protected)/goals/page.tsx`
- Modify: `app/(protected)/goals/[id]/page.tsx`
- Modify: `app/(protected)/projects/page.tsx`
- Create: `app/(protected)/settings/loading.tsx`
- Create: `app/(protected)/receipt-upload/loading.tsx`
- Create: `docs/quality/phase-2-preview-acceptance.md`
- Modify: `README.md`

**Interfaces:**
- All destructive UI actions require `ConfirmDialog` before invoking their
  existing server action.
- Preview configuration uses only `DATABASE_URL`, `NEXTAUTH_SECRET`, and
  `NEXTAUTH_URL`.

- [ ] **Step 1: Add the component-test boundary and failing confirmation tests**

Add `@testing-library/react`, `@testing-library/user-event`, and `jsdom` as
development dependencies. Mark the focused Vitest file with the jsdom
environment directive. Assert cancel never invokes the action and confirm
invokes it exactly once, then use the shared control for category, source,
goal, contribution, and project deletes.

Run:

```bash
npx --yes --package=node@22 --call='npm run test:run -- tests/destructive-action-button.test.tsx'
```

Expected: FAIL because the shared destructive-action control does not exist.

- [ ] **Step 2: Complete loading and mobile preflight**

Add skeleton-only loading pages for Settings and Receipt Upload. Review 375px
tap targets, navigation, forms, tables, charts, dialogs, and safe validation.
Restrict fixes to specification §27 requirements.

- [ ] **Step 3: Verify the local release candidate again**

Run:

```bash
npx --yes --package=node@22 --call='npm run verify'
npx --yes --package=node@22 --call='npm run test:integration'
git diff --check
```

- [ ] **Step 4: Create the Vercel Preview**

Link the repository only after confirming the intended Vercel project. Use the
disposable Neon database for Preview, never Production. Configure the three
approved environment variables, deploy once to obtain the address, set
`NEXTAUTH_URL` to that address or its stable branch domain, and redeploy.

- [ ] **Step 5: Execute and record acceptance**

Record pass/fail evidence for specification §29 and §30:

- register, login, logout, session persistence, protected redirect;
- reference-ledger entry and all transaction/card edge cases;
- goals, projects, renewals, dashboard, all ten reports, CSV;
- User A/User B isolation;
- rate-limit 429 and response headers;
- activity retention/pagination;
- 375px navigation/forms/tables/charts/dialogs/empty/loading/error states.

Any financial, security, ownership, or data-integrity failure returns to a
failing regression test and scoped fix. Production deployment is not part of
this task.

- [ ] **Step 6: Commit acceptance evidence**

```bash
git add package.json package-lock.json components app docs/quality README.md tests
git commit -m "docs: verify phase 2 preview acceptance"
```

---

## Whole-Phase Completion

After Task 17 review is clean:

1. Run the full Task 16 gate again from a clean install.
2. Confirm the Vercel Preview status and acceptance report.
3. Run an independent whole-phase review from merge base to final head.
4. Preserve the worktree for PR feedback.
5. Offer merge, pull-request, or keep-as-is integration options.

Phase 2 does not authorize a Production deployment.
