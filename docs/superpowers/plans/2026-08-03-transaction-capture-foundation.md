# Transaction Capture Foundation Implementation Plan

<!-- markdownlint-disable MD013 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a user-owned transaction-draft foundation and a responsive spreadsheet-style capture workspace that imports up to 200 validated transactions atomically through the existing financial rules.

**Architecture:** Clipboard input is parsed in the browser without numeric coercion, mapped into persisted `TransactionDraft` records, and validated again on the server. A new reusable transaction-creation service owns parsing, reference ownership, type-matrix validation, normalization, persistence, and activity logging; both the existing single-entry action and idempotent batch import call this service. The capture UI presents the same draft state as an editable desktop ledger and mobile cards, with provenance and readiness always visible.

**Tech Stack:** Node.js 22, Next.js 15 App Router, React 19, TypeScript 5.9, Tailwind CSS 3.4, Prisma 6/PostgreSQL, Zod 4, Papa Parse 5.5, Vitest 2.1, Testing Library.

## Global Constraints

- Read `money-quality-tracker-spec-v4.md` §§6.4–6.5, 20, 27–30,
  the relevant workflow and validation sections of `codex-prompting-guide-v2.md`,
  and `docs/superpowers/specs/2026-08-03-transaction-capture-program-design.md`
  before starting each task.
- Implement only capture foundation, spreadsheet import, and the approved compact quick-draft path. Do not implement inbound email, Gmail, Outlook, OCR, AI, or Production deployment in this phase.
- Work one task at a time. Obtain the task's specification and quality review before starting its successor; do not expand scope without approval.
- Use test-driven development: demonstrate the focused RED failure, implement the smallest change, then run focused and relevant regression suites before committing.
- Preserve `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`. Never introduce `AUTH_SECRET` or `AUTH_URL`; this phase adds no environment variables.
- Obtain `userId` only from `requireAuth()`. Scope every draft, batch, and referenced record by that authenticated ID.
- Preserve positive exact `Decimal(18,2)` text until Prisma persistence. Never convert transaction money through JavaScript `number`.
- Preserve the complete INCOME, EXPENSE, TRANSFER, REFUND, and ADJUSTMENT field matrix, card target defaults, fee-waiver defaults, and activity-log atomicity.
- Limit pasted input to 1,000,000 UTF-8 bytes and 200 non-empty rows on both client and server.
- Use the approved Living Ledger visual tokens, explicit status text, 44-pixel mobile targets, visible focus, reduced motion, and no document-level overflow at 375 pixels.
- End the phase with Node.js 22 `npm run verify`, the complete real-PostgreSQL integration suite, migration deployment validation, focused browser/mobile acceptance, and an independent whole-phase review.
- Do not deploy to Production. Preview deployment requires a separately approved final task after all local gates pass.

---

## File Map

### Canonical transaction boundary

- `lib/transactions/create.ts` — canonical create schemas, reference loading, type validation, normalization, persistence, and individual activity logging.
- `lib/actions/transactions.ts` — authentication/rate-limit/revalidation wrapper plus existing read, update, and delete actions.
- `tests/transaction-create.test.ts` — pure parsing and preparation characterization.

### Draft domain and persistence

- `prisma/schema.prisma` and `prisma/migrations/20260803000000_add_transaction_capture_drafts/migration.sql` — draft and import-batch persistence.
- `lib/transaction-drafts/types.ts` — serializable draft input, issue, and view types.
- `lib/transaction-drafts/validation.ts` — draft-to-canonical conversion and status assessment.
- `lib/transaction-drafts/paste.ts` — bounded CSV/TSV parsing, header detection, column mapping, and exact-text row normalization.
- `lib/transaction-drafts/retention.ts` — bounded deletion of unresolved drafts after 30 days.
- `lib/actions/transaction-drafts.ts` — authenticated draft CRUD, dismissal, and atomic idempotent import.
- `tests/transaction-draft-validation.test.ts`, `tests/transaction-paste.test.ts`, and `tests/transaction-drafts.actions.test.ts` — pure and mocked action contracts.
- `tests/transaction-draft-retention.test.ts` — retention limits and failure containment.
- `tests/integration/transaction-drafts.integration.test.ts` — persistence, ownership, idempotency, rollback, and reconciliation.

### Capture experience

- `app/(protected)/transactions/capture/page.tsx` and `loading.tsx` — protected data boundary and loading state.
- `components/transaction-capture/CaptureWorkspace.tsx` — mode, capture-session, and server-action orchestration.
- `components/transaction-capture/PasteInput.tsx` — clipboard/file-text input and parsing feedback.
- `components/transaction-capture/ColumnMapper.tsx` — detected/explicit column mapping.
- `components/transaction-capture/DraftLedger.tsx` — desktop editable table and keyboard navigation.
- `components/transaction-capture/DraftCards.tsx` — 375-pixel mobile editing.
- `components/transaction-capture/DraftInspector.tsx` — type-specific advanced fields and findings.
- `components/transaction-capture/ImportBar.tsx` — sticky counts, selection, and atomic save.
- `components/transaction-capture/OriginStamp.tsx` and `StatusRail.tsx` — provenance and readiness semantics.
- `tests/transaction-capture.ui.test.tsx` and `tests/transaction-capture-page.test.tsx` — interaction, rendering, and route wiring.

---

### Task 1: Extract the Canonical Transaction-Create Service

**Files:**

- Create: `lib/transactions/create.ts`
- Create: `tests/transaction-create.test.ts`
- Modify: `lib/actions/transactions.ts:1-621`
- Modify: `tests/transactions.actions.test.ts`
- Test: `tests/integration/transactions.integration.test.ts`

**Interfaces:**

- Produces: `TransactionCreateInput`, `TransactionCreateData`, `TransactionCreateIssue`, `OwnedTransactionReferences`, `PreparedTransactionCreate`, `TransactionCreateResult`, `parseTransactionCreateInput()`, `loadOwnedTransactionReferences()`, `prepareTransactionCreate()`, `persistPreparedTransaction()`, and `createOwnedTransaction()`.
- Preserves: `TransactionFormInput` remains importable from `lib/actions/transactions.ts` through a type re-export.

- [ ] **Step 1: Add RED characterization tests for exact parsing and preparation**

```ts
import { TransactionType } from "@prisma/client";
import {
  parseTransactionCreateInput,
  prepareTransactionCreate
} from "@/lib/transactions/create";

it("preserves Decimal(18,2) input as exact text", () => {
  const parsed = parseTransactionCreateInput({
    type: TransactionType.INCOME,
    amount: "90071992547409.99",
    title: "Salary",
    transactionDate: "2026-08-03",
    toMoneySourceId: "bank-a"
  });
  expect(parsed).toMatchObject({ ok: true });
  if (parsed.ok) expect(parsed.data.amount).toBe("90071992547409.99");
});

it("rejects a foreign reference set before persistence", () => {
  const parsed = parseTransactionCreateInput({
    type: TransactionType.EXPENSE,
    amount: "45.00",
    title: "Coffee",
    transactionDate: "2026-08-03",
    fromMoneySourceId: "foreign-source"
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(
    prepareTransactionCreate(parsed.data, {
      categories: new Map(),
      expenses: new Set(),
      moneySources: new Map(),
      projects: new Set(),
      recurringPayments: new Set()
    })
  ).toEqual({
    ok: false,
    issues: [{ field: "fromMoneySourceId", message: "Referenced money source not found." }]
  });
});
```

- [ ] **Step 2: Run the new test and confirm RED**

Run: `npx vitest run tests/transaction-create.test.ts`

Expected: FAIL because `lib/transactions/create.ts` does not exist.

- [ ] **Step 3: Move create-only parsing and preparation into the focused service**

```ts
export type TransactionCreateIssue = {
  field: keyof TransactionCreateInput | "form";
  message: string;
};

export type TransactionCreateInput = z.input<typeof transactionSchema>;
export type TransactionCreateData = z.infer<typeof transactionSchema>;

export type PreparedTransactionCreate = {
  transaction: Omit<
    Prisma.TransactionUncheckedCreateInput,
    "id" | "userId" | "createdAt" | "updatedAt"
  >;
};

export type OwnedTransactionReferences = {
  categories: Map<string, { defaultCountTowardFeeWaiver: boolean }>;
  expenses: Set<string>;
  moneySources: Map<string, { type: MoneySourceType }>;
  projects: Set<string>;
  recurringPayments: Set<string>;
};

export function parseTransactionCreateInput(
  input: unknown | FormData
):
  | { ok: true; data: TransactionCreateData }
  | { ok: false; issues: TransactionCreateIssue[] };

export async function loadOwnedTransactionReferences(
  db: Prisma.TransactionClient,
  userId: string,
  inputs: readonly TransactionCreateData[]
): Promise<OwnedTransactionReferences>;

export function prepareTransactionCreate(
  data: TransactionCreateData,
  references: OwnedTransactionReferences
):
  | { ok: true; data: PreparedTransactionCreate }
  | { ok: false; issues: TransactionCreateIssue[] };

export async function persistPreparedTransaction(
  db: Prisma.TransactionClient,
  userId: string,
  prepared: PreparedTransactionCreate
): Promise<Transaction>;

export type TransactionCreateResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; issues: TransactionCreateIssue[] };

export async function createOwnedTransaction(
  db: Prisma.TransactionClient,
  userId: string,
  input: unknown | FormData
): Promise<TransactionCreateResult>;
```

Move the existing Zod decimal schema, nullable normalization, reference rules,
`validateTransactionFields()` call, adjustment-target default, fee-waiver
default, Prisma create, and `TRANSACTION_CREATED` activity write without
changing their outcomes. `loadOwnedTransactionReferences()` must aggregate all
unique IDs so a 200-row batch does not issue ownership queries per row.

- [ ] **Step 4: Delegate the existing action to the canonical service**

```ts
export type { TransactionCreateInput as TransactionFormInput } from "@/lib/transactions/create";

export async function createTransaction(
  input: TransactionCreateInput | FormData
): Promise<TransactionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const result = await prisma.$transaction((db) =>
    createOwnedTransaction(db, user.id, input)
  );
  if (!result.ok) return { ok: false, error: result.issues.map(({ message }) => message).join(" ") };
  revalidatePath("/transactions");
  return { ok: true };
}
```

Retain existing update/delete/read/search code in `lib/actions/transactions.ts`.
Do not change the existing individual activity metadata shape.

- [ ] **Step 5: Run focused and transaction regression suites**

Run:

```bash
npx vitest run tests/transaction-create.test.ts tests/transactions.actions.test.ts tests/transactions.test.ts
npm run test:integration -- tests/integration/transactions.integration.test.ts
```

Expected: all tests PASS, including all five persisted transaction types and
foreign-reference rejection.

- [ ] **Step 6: Commit the reusable create boundary**

```bash
git add lib/transactions/create.ts lib/actions/transactions.ts tests/transaction-create.test.ts tests/transactions.actions.test.ts
git commit -m "refactor: extract canonical transaction creation"
```

---

### Task 2: Add Draft and Import-Batch Persistence

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260803000000_add_transaction_capture_drafts/migration.sql`
- Create: `tests/transaction-draft-schema.test.ts`
- Modify: `tests/integration/helpers/audit-context.ts`

**Interfaces:**

- Produces Prisma enums `TransactionDraftOrigin`, `TransactionDraftStatus`, and `TransactionImportBatchStatus`.
- Produces Prisma models `TransactionDraft` and `TransactionImportBatch` with user-owned cascade deletion and `[userId, captureKey, position]` uniqueness.

- [ ] **Step 1: Write a RED Prisma-model contract test**

```ts
import { Prisma } from "@prisma/client";

it("exposes the transaction draft and import batch models", () => {
  const names = Prisma.dmmf.datamodel.models.map(({ name }) => name);
  expect(names).toEqual(expect.arrayContaining([
    "TransactionDraft",
    "TransactionImportBatch"
  ]));
});
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run: `npx vitest run tests/transaction-draft-schema.test.ts`

Expected: FAIL because neither model exists.

- [ ] **Step 3: Add the exact Prisma domain**

```prisma
enum TransactionDraftOrigin {
  QUICK
  PASTE
  EMAIL
}

enum TransactionDraftStatus {
  NEEDS_REVIEW
  READY
  IMPORTING
  IMPORTED
  DISMISSED
}

enum TransactionImportBatchStatus {
  IMPORTING
  IMPORTED
}

model TransactionDraft {
  id                       String                 @id @default(cuid())
  userId                   String
  captureKey               String
  position                 Int
  origin                   TransactionDraftOrigin
  status                   TransactionDraftStatus @default(NEEDS_REVIEW)
  confidence               Int?
  type                     TransactionType?
  amountText               String?
  currency                 String?
  title                    String?
  description              String?
  transactionDateText      String?
  categoryId               String?
  qualityRating            QualityRating?
  fromMoneySourceId        String?
  toMoneySourceId          String?
  adjustedMoneySourceId    String?
  adjustmentDirection      AdjustmentDirection?
  adjustmentTarget         AdjustmentTarget?
  projectId                String?
  relatedTransactionId     String?
  countTowardFeeWaiver     Boolean?
  recurringPaymentId       String?
  isInstallmentRelated     Boolean                @default(false)
  duplicateFingerprint     String?
  duplicateConfirmed       Boolean                @default(false)
  validationIssues         Json                   @default("[]")
  rawRow                   Json?
  importBatchId            String?
  importedTransactionId    String?
  expiresAt                DateTime
  createdAt                DateTime               @default(now())
  updatedAt                DateTime               @updatedAt
  user                     User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  importBatch              TransactionImportBatch? @relation(fields: [importBatchId], references: [id], onDelete: SetNull)

  @@unique([userId, captureKey, position])
  @@index([userId, status])
  @@index([userId, captureKey, duplicateFingerprint])
  @@index([importBatchId])
  @@index([expiresAt])
}

model TransactionImportBatch {
  id               String                       @id @default(cuid())
  userId           String
  idempotencyKey   String
  origin           TransactionDraftOrigin
  status           TransactionImportBatchStatus @default(IMPORTING)
  draftIds         Json                         @default("[]")
  transactionIds   Json                         @default("[]")
  createdAt        DateTime                     @default(now())
  updatedAt        DateTime                     @updatedAt
  user             User                         @relation(fields: [userId], references: [id], onDelete: Cascade)
  drafts           TransactionDraft[]

  @@unique([userId, idempotencyKey])
  @@index([userId, createdAt])
}
```

Add `transactionDrafts TransactionDraft[]` and
`transactionImportBatches TransactionImportBatch[]` to `User`. Candidate
category/source/project IDs intentionally remain plain strings: they are
untrusted suggestions rechecked at every validation/import boundary, and a
deleted source should turn a draft into a review issue rather than poison a
relation.

- [ ] **Step 4: Add the forward-only migration and cleanup support**

Write SQL creating the three enums, two tables, unique/index definitions, and
foreign keys shown by the schema. Do not add `DROP`, `TRUNCATE`, or unbounded
`DELETE`. `cleanupAuditContext()` already deletes users with cascade; add an
integration assertion that both new child models disappear with the user.

- [ ] **Step 5: Generate and validate Prisma artifacts**

Run:

```bash
npx prisma generate
npx prisma format
npx prisma validate
npx vitest run tests/transaction-draft-schema.test.ts
rg -n "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM" prisma/migrations/20260803000000_add_transaction_capture_drafts/migration.sql
```

Expected: Prisma validation and test PASS; the safety scan returns no matches.

- [ ] **Step 6: Apply the migration to the disposable database**

Run: `npm run prisma:deploy`

Expected: `20260803000000_add_transaction_capture_drafts` applies successfully
and a second run reports no pending migrations.

- [ ] **Step 7: Commit schema and migration**

```bash
git add prisma/schema.prisma prisma/migrations/20260803000000_add_transaction_capture_drafts/migration.sql tests/transaction-draft-schema.test.ts tests/integration/helpers/audit-context.ts
git commit -m "feat: add transaction draft persistence"
```

---

### Task 3: Define Serializable Draft Types and Validation

**Files:**

- Create: `lib/transaction-drafts/types.ts`
- Create: `lib/transaction-drafts/validation.ts`
- Create: `tests/transaction-draft-validation.test.ts`

**Interfaces:**

- Produces: `DraftField`, `DraftFieldIssue`, `TransactionDraftInput`, `TransactionDraftView`, `DraftAssessment`, `transactionDraftInputSchema`, `transactionDraftPatchSchema`, `computeDraftFingerprint()`, `findDuplicateDraftPositions()`, `transactionDraftRecordToInput()`, `transactionDraftRecordToView()`, `draftToTransactionInput()`, and `assessDraft()`.
- Consumes: canonical `parseTransactionCreateInput()` and `prepareTransactionCreate()` from Task 1.

- [ ] **Step 1: Write RED tests for exact conversion and status assessment**

```ts
it("keeps exact amount text and marks a complete expense ready", () => {
  const result = assessDraft(expenseDraft({
    amountText: "90071992547409.99",
    fromMoneySourceId: "bank-a"
  }), ownedReferences());
  expect(result.status).toBe("READY");
  expect(result.input?.amount).toBe("90071992547409.99");
});

it("returns field-addressable findings for incomplete transfers", () => {
  const result = assessDraft(transferDraft({ toMoneySourceId: null }), ownedReferences());
  expect(result).toMatchObject({
    status: "NEEDS_REVIEW",
    issues: expect.arrayContaining([
      { field: "toMoneySourceId", message: expect.any(String) }
    ])
  });
});
```

- [ ] **Step 2: Run the validation test and confirm RED**

Run: `npx vitest run tests/transaction-draft-validation.test.ts`

Expected: FAIL because the draft modules do not exist.

- [ ] **Step 3: Implement the exact serializable contracts**

```ts
import {
  AdjustmentDirection,
  AdjustmentTarget,
  QualityRating,
  type TransactionDraft,
  TransactionDraftOrigin,
  TransactionType
} from "@prisma/client";
import { z } from "zod";
import type {
  OwnedTransactionReferences,
  TransactionCreateData
} from "@/lib/transactions/create";

export type DraftField =
  | "type" | "amountText" | "currency" | "title"
  | "transactionDateText" | "categoryId" | "qualityRating"
  | "fromMoneySourceId" | "toMoneySourceId"
  | "adjustedMoneySourceId" | "adjustmentDirection"
  | "adjustmentTarget" | "projectId" | "relatedTransactionId"
  | "countTowardFeeWaiver" | "recurringPaymentId"
  | "isInstallmentRelated" | "duplicateConfirmed"
  | "description" | "form";

export type DraftFieldIssue = {
  field: DraftField;
  message: string;
};

export type TransactionDraftInput = {
  captureKey: string;
  position: number;
  origin: TransactionDraftOrigin;
  type: TransactionType | null;
  amountText: string | null;
  currency: string | null;
  title: string | null;
  description: string | null;
  transactionDateText: string | null;
  categoryId: string | null;
  qualityRating: QualityRating | null;
  fromMoneySourceId: string | null;
  toMoneySourceId: string | null;
  adjustedMoneySourceId: string | null;
  adjustmentDirection: AdjustmentDirection | null;
  adjustmentTarget: AdjustmentTarget | null;
  projectId: string | null;
  relatedTransactionId: string | null;
  countTowardFeeWaiver: boolean | null;
  recurringPaymentId: string | null;
  isInstallmentRelated: boolean;
  duplicateConfirmed: boolean;
  rawRow: Record<string, string> | null;
};

const nullableBounded = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const nullableId = z.string().trim().min(1).max(191).nullable();

export const transactionDraftInputSchema = z.object({
  captureKey: z.string().uuid(),
  position: z.number().int().min(0).max(199),
  origin: z.enum(["QUICK", "PASTE"]),
  type: z.nativeEnum(TransactionType).nullable(),
  amountText: nullableBounded(64),
  currency: nullableBounded(8),
  title: nullableBounded(200),
  description: nullableBounded(2_000),
  transactionDateText: nullableBounded(64),
  categoryId: nullableId,
  qualityRating: z.nativeEnum(QualityRating).nullable(),
  fromMoneySourceId: nullableId,
  toMoneySourceId: nullableId,
  adjustedMoneySourceId: nullableId,
  adjustmentDirection: z.nativeEnum(AdjustmentDirection).nullable(),
  adjustmentTarget: z.nativeEnum(AdjustmentTarget).nullable(),
  projectId: nullableId,
  relatedTransactionId: nullableId,
  countTowardFeeWaiver: z.boolean().nullable(),
  recurringPaymentId: nullableId,
  isInstallmentRelated: z.boolean(),
  duplicateConfirmed: z.boolean(),
  rawRow: z.record(z.string(), z.string().max(10_000)).nullable()
}).strict();

export const transactionDraftPatchSchema = transactionDraftInputSchema
  .omit({ captureKey: true, position: true, origin: true })
  .partial()
  .strict();

export type TransactionDraftView = TransactionDraftInput & {
  id: string;
  status: "NEEDS_REVIEW" | "READY" | "IMPORTING" | "IMPORTED" | "DISMISSED";
  confidence: number | null;
  issues: DraftFieldIssue[];
  importBatchId: string | null;
  importedTransactionId: string | null;
  expiresAt: string;
  possibleDuplicate: boolean;
};

export type DraftAssessment = {
  status: "NEEDS_REVIEW" | "READY";
  issues: DraftFieldIssue[];
  input: TransactionCreateData | null;
};

export function draftToTransactionInput(
  draft: TransactionDraftInput
): Record<string, unknown>;

export function transactionDraftRecordToInput(
  draft: TransactionDraft
): TransactionDraftInput;

export function transactionDraftRecordToView(
  draft: TransactionDraft
): TransactionDraftView;

export function assessDraft(
  draft: TransactionDraftInput,
  references: OwnedTransactionReferences,
  context?: { possibleDuplicate: boolean }
): DraftAssessment;

export function computeDraftFingerprint(
  draft: TransactionDraftInput
): string | null;

export function findDuplicateDraftPositions(
  drafts: readonly TransactionDraftInput[]
): Set<number>;
```

`draftToTransactionInput()` must map `amountText` and `transactionDateText`
without numeric coercion. `assessDraft()` maps canonical service issues back to
draft fields and returns only serializable arrays/objects to client components.
`computeDraftFingerprint()` hashes normalized type, exact amount text, date,
title, and applicable source IDs with SHA-256. Within one capture session,
`findDuplicateDraftPositions()` marks every repeated position after the first;
`assessDraft()` adds a `form` finding until that row sets
`duplicateConfirmed: true`. It does not compare amount alone or silently remove
a row.

- [ ] **Step 4: Cover all five type matrices and defaults**

Add table-driven cases for INCOME, EXPENSE, TRANSFER, REFUND, and ADJUSTMENT,
including credit-card adjustment target, quality restrictions, same-source
transfer rejection, nullable optional values, and category fee-waiver defaults.
Add two identical rows to prove the later row requires explicit duplicate
confirmation and two same-amount rows with different dates remain independent.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npx vitest run tests/transaction-draft-validation.test.ts tests/transaction-create.test.ts
npm run typecheck
```

Expected: all tests and typecheck PASS.

- [ ] **Step 6: Commit draft validation**

```bash
git add lib/transaction-drafts/types.ts lib/transaction-drafts/validation.ts tests/transaction-draft-validation.test.ts
git commit -m "feat: validate transaction drafts"
```

---

### Task 4: Parse and Map Spreadsheet Input

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/transaction-drafts/paste.ts`
- Create: `tests/transaction-paste.test.ts`

**Interfaces:**

- Produces: `MAX_PASTE_BYTES`, `MAX_DRAFT_ROWS`, `DraftMappableField`, `PasteColumn`, `ParsedTable`, `ColumnMapping`, `DetectedColumnMapping`, `PasteMappingContext`, `parsePastedTable()`, `detectColumnMapping()`, and `mapParsedRows()` with the exact signatures in Steps 4–5.
- Consumes: `TransactionDraftInput` from Task 3.

- [ ] **Step 1: Install the bounded browser parser dependency**

Run:

```bash
npm install papaparse@5.5.4
npm install --save-dev @types/papaparse@5.5.2
npm audit --omit=dev --audit-level=high
```

Expected: production audit reports zero high or critical vulnerabilities.

- [ ] **Step 2: Write RED parser tests before the module exists**

```ts
it("parses quoted CSV and keeps amounts as strings", () => {
  const parsed = parsePastedTable(
    'Date,Title,Amount,Source\n2026-08-03,"Cafe, District 1",90071992547409.99,VCB'
  );
  expect(parsed.rows[0]).toEqual([
    "2026-08-03", "Cafe, District 1", "90071992547409.99", "VCB"
  ]);
});

it.each([
  ["oversized text", "x".repeat(1_000_001)],
  ["more than 200 rows", Array.from({ length: 201 }, () => "a\tb").join("\n")]
])("rejects %s", (_label, text) => {
  expect(() => parsePastedTable(text)).toThrow();
});
```

- [ ] **Step 3: Run the parser test and confirm RED**

Run: `npx vitest run tests/transaction-paste.test.ts`

Expected: FAIL because `paste.ts` does not exist.

- [ ] **Step 4: Implement bounded parsing with all values kept as text**

```ts
export const MAX_PASTE_BYTES = 1_000_000;
export const MAX_DRAFT_ROWS = 200;

export type PasteColumn = {
  index: number;
  label: string;
  samples: string[];
};

export type ParsedTable = {
  columns: PasteColumn[];
  rows: string[][];
  delimiter: "," | "\t";
  hasHeader: boolean;
};

export function parsePastedTable(text: string): ParsedTable;

const result = Papa.parse<string[]>(text, {
  delimiter: "",
  dynamicTyping: false,
  skipEmptyLines: "greedy",
  transform: (value) => value.trim()
});
```

Count bytes with `new TextEncoder().encode(text).byteLength` before parsing.
Reject parser errors, zero columns, inconsistent rows that cannot be padded, and
more than 200 non-empty data rows. Preserve Unicode and quoted newlines.

- [ ] **Step 5: Implement deterministic header detection and row mapping**

```ts
export type DraftMappableField =
  | "transactionDateText" | "type" | "title" | "amountText"
  | "currency" | "categoryId" | "qualityRating"
  | "fromMoneySourceId" | "toMoneySourceId" | "projectId"
  | "description" | "adjustmentDirection" | "adjustmentTarget"
  | "relatedTransactionId";

export type ColumnMapping = Partial<Record<DraftMappableField, number>>;

export type DetectedColumnMapping = {
  mapping: ColumnMapping;
  ambiguousFields: DraftMappableField[];
};

export type PasteMappingContext = {
  captureKey: string;
  defaults: {
    currency: string;
    transactionDateText: string;
    type: TransactionType;
  };
  categories: readonly { id: string; name: string }[];
  moneySources: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string }[];
};

export function detectColumnMapping(
  columns: readonly PasteColumn[]
): DetectedColumnMapping;

export function mapParsedRows(
  table: ParsedTable,
  mapping: ColumnMapping,
  context: PasteMappingContext
): TransactionDraftInput[];
```

Support normalized aliases for date, type, title/merchant, amount, currency,
category, quality, from/source/account, to/destination, project, description,
adjustment direction/target, and related transaction. Auto-map only one unique
column per field. Exact case-insensitive source/category/project name matches
map to owned IDs; zero or multiple matches create a row issue rather than a
guess. Apply default currency/date/type only when the input cell is blank.
Every mapped row sets `origin: "PASTE"`, contiguous zero-based `position`,
`isInstallmentRelated: false`, and `duplicateConfirmed: false`; it retains each
source cell in `rawRow` for correction until import or dismissal.

- [ ] **Step 6: Add fixtures for TSV, headerless, reordered, malformed, Unicode, and duplicate headers**

```ts
expect(detectColumnMapping([
  { index: 0, label: "Ngày", samples: [] },
  { index: 1, label: "Nội dung", samples: [] },
  { index: 2, label: "Số tiền", samples: [] }
]).mapping).toEqual({
  transactionDateText: 0,
  title: 1,
  amountText: 2
});
```

Include `VCB`, `OCB`, and `HSBC` only as ordinary source-name examples; do not
add email parsing or institution assumptions.

- [ ] **Step 7: Run parser tests, lint, and production audit**

Run:

```bash
npx vitest run tests/transaction-paste.test.ts
npm run lint
npm audit --omit=dev --audit-level=high
```

Expected: all checks PASS and production audit reports zero vulnerabilities at
the configured threshold.

- [ ] **Step 8: Commit paste parsing**

```bash
git add package.json package-lock.json lib/transaction-drafts/paste.ts tests/transaction-paste.test.ts
git commit -m "feat: parse spreadsheet transaction rows"
```

---

### Task 5: Add Authenticated Draft CRUD Actions

**Files:**

- Create: `lib/actions/transaction-drafts.ts`
- Create: `lib/transaction-drafts/retention.ts`
- Create: `tests/transaction-drafts.actions.test.ts`
- Create: `tests/transaction-draft-retention.test.ts`
- Create: `tests/integration/transaction-drafts.integration.test.ts`

**Interfaces:**

- Produces: `DraftActionResult<T>`, `cleanupExpiredTransactionDrafts()`, `savePasteDrafts()`, `saveQuickDraft()`, `listTransactionDrafts()`, `updateTransactionDraft()`, and `dismissTransactionDrafts()` with the exact signatures in Step 3.
- Consumes: draft types/validation, aggregated reference loading, `requireAuth()`, mutation rate limiting, and Prisma draft models.

- [ ] **Step 1: Write RED action contract tests**

```ts
await expect(savePasteDrafts({
  captureKey: crypto.randomUUID(),
  rows: [expenseDraft({ position: 0 })]
})).resolves.toMatchObject({
  ok: true,
  drafts: [{ origin: "PASTE", status: "READY", amountText: "45.00" }]
});

await expect(updateTransactionDraft("foreign-draft", {
  title: "Stolen update"
})).resolves.toEqual({ ok: false, error: "Draft not found." });
```

Mock `requireAuth`, rate limiting, and Prisma following existing action-test
patterns. Assert rate-limit failure performs zero writes.

- [ ] **Step 2: Run action tests and confirm RED**

Run: `npx vitest run tests/transaction-drafts.actions.test.ts`

Expected: FAIL because the server-action module does not exist.

- [ ] **Step 3: Implement bounded schemas and serializable results**

```ts
const saveDraftsSchema = z.object({
  captureKey: z.string().uuid(),
  rows: z.array(transactionDraftInputSchema).min(1).max(MAX_DRAFT_ROWS)
}).superRefine(({ captureKey, rows }, context) => {
  rows.forEach((row, index) => {
    if (row.captureKey !== captureKey || row.origin !== "PASTE" || row.position !== index) {
      context.addIssue({
        code: "custom",
        path: ["rows", index],
        message: "Paste rows must belong to this capture and use contiguous positions."
      });
    }
  });
});

export type DraftActionResult<
  T extends object = Record<string, never>
> =
  | ({ ok: true } & T)
  | { ok: false; error: string; draftId?: string };

export async function savePasteDrafts(input: {
  captureKey: string;
  rows: readonly unknown[];
}): Promise<DraftActionResult<{ drafts: TransactionDraftView[] }>>;

export async function saveQuickDraft(
  input: unknown
): Promise<DraftActionResult<{ draft: TransactionDraftView }>>;

export async function listTransactionDrafts(
  captureKey: string
): Promise<DraftActionResult<{ drafts: TransactionDraftView[] }>>;

export async function updateTransactionDraft(
  id: string,
  patch: unknown
): Promise<DraftActionResult<{ draft: TransactionDraftView }>>;

export async function dismissTransactionDrafts(
  ids: readonly string[]
): Promise<DraftActionResult<{ dismissedCount: number }>>;

export async function cleanupExpiredTransactionDrafts(
  now?: Date,
  maximumRows?: number
): Promise<number>;
```

Parse rows with `transactionDraftInputSchema` and patches with
`transactionDraftPatchSchema`. Recompute the UTF-8 size of serialized
`rawRow` values and enforce row limits
on the server. Set `expiresAt` to
exactly 30 days after creation. Upsert by `[userId, captureKey, position]` and
delete only surplus rows within the same authenticated capture session when a
smaller replacement is saved.

After every save, edit, or replacement, load the authenticated capture session,
compute each non-empty fingerprint, and reassess all affected rows in the same
transaction with `findDuplicateDraftPositions()`. Store only the SHA-256
fingerprint, never a concatenated financial value. A later matching row remains
`NEEDS_REVIEW` until the user explicitly sets `duplicateConfirmed: true`.

- [ ] **Step 4: Implement scoped reads, edits, quick drafts, and dismissal**

`listTransactionDrafts(captureKey)` orders by position and returns no Prisma
Decimal or `Date` instances. `updateTransactionDraft(id, patch)` loads by
`{id,userId}`, revalidates the full merged draft, and never trusts a client
status or validation issue. `saveQuickDraft()` writes one `QUICK` row using the
same path. Dismissal accepts at most 200 IDs, updates only `{userId,id in ...}`
records, nulls candidate fields/rawRow, and records one activity entry with
count and origin only.

Implement retention in `lib/transaction-drafts/retention.ts` by validating
`maximumRows` as an integer from 1 through 500, selecting at most that many
`NEEDS_REVIEW` or `READY` IDs ordered by `expiresAt`, and deleting exactly those
IDs in one transaction. `listTransactionDrafts()` awaits this bounded cleanup
but contains cleanup failure so users can still reach their drafts; logs include
only the error class, never draft data.

- [ ] **Step 5: Add real-PostgreSQL ownership and persistence tests**

Use two audit users. Verify User B cannot list, edit, dismiss, or overwrite User
A drafts even with the same `captureKey`. Verify foreign category/source/
project/refund IDs produce `NEEDS_REVIEW`, no canonical transaction, and no
foreign names in the returned view.
Seed 501 expired unresolved drafts plus one future and one imported draft;
assert one cleanup removes exactly the oldest 500 and a second removes the last
expired unresolved row without touching future/imported records.

- [ ] **Step 6: Run focused unit and integration tests**

Run:

```bash
npx vitest run tests/transaction-drafts.actions.test.ts tests/transaction-draft-retention.test.ts
npm run test:integration -- tests/integration/transaction-drafts.integration.test.ts
```

Expected: all tests PASS with bounded cleanup through audit-user cascade.

- [ ] **Step 7: Commit draft CRUD**

```bash
git add lib/actions/transaction-drafts.ts lib/transaction-drafts/retention.ts tests/transaction-drafts.actions.test.ts tests/transaction-draft-retention.test.ts tests/integration/transaction-drafts.integration.test.ts
git commit -m "feat: manage owned transaction drafts"
```

---

### Task 6: Import Drafts Atomically and Idempotently

**Files:**

- Modify: `lib/actions/transaction-drafts.ts`
- Modify: `lib/activity.ts`
- Modify: `tests/transaction-drafts.actions.test.ts`
- Modify: `tests/integration/transaction-drafts.integration.test.ts`

**Interfaces:**

- Produces: `ImportTransactionDraftsInput`, `ImportTransactionDraftsResult`, and `importTransactionDrafts({ ids, idempotencyKey })` returning transaction IDs and imported count.
- Consumes: `runSerializable()`, canonical transaction preparation/persistence, `TransactionImportBatch`, and standard `TRANSACTION_CREATED` activity records.

- [ ] **Step 1: Add RED tests for all-or-none and replay behavior**

```ts
const first = await importTransactionDrafts({
  ids: readyDraftIds,
  idempotencyKey: "3f99c1db-3c04-4f1d-a430-cdcb31cdd744"
});
const replay = await importTransactionDrafts({
  ids: readyDraftIds,
  idempotencyKey: "3f99c1db-3c04-4f1d-a430-cdcb31cdd744"
});
expect(first.ok).toBe(true);
if (!first.ok) throw new Error(first.error);
expect(replay).toEqual(first);
expect(await prisma.transaction.count({ where: { id: { in: first.transactionIds } } })).toBe(readyDraftIds.length);
```

Add a forced activity failure case expecting zero transactions, zero import
batch, and unchanged READY drafts.

- [ ] **Step 2: Run the focused integration tests and confirm RED**

Run: `npm run test:integration -- tests/integration/transaction-drafts.integration.test.ts`

Expected: FAIL because `importTransactionDrafts()` is absent.

- [ ] **Step 3: Implement one serializable idempotent transaction**

```ts
export type ImportTransactionDraftsInput = {
  ids: readonly string[];
  idempotencyKey: string;
};

export type ImportTransactionDraftsResult = DraftActionResult<{
  transactionIds: string[];
  importedCount: number;
}>;

const importDraftsSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(MAX_DRAFT_ROWS)
    .refine((ids) => new Set(ids).size === ids.length, "Select each draft once."),
  idempotencyKey: z.string().uuid()
}).strict();

const storedIdsSchema = z.array(z.string()).max(MAX_DRAFT_ROWS);

function readStoredIds(value: Prisma.JsonValue) {
  return storedIdsSchema.parse(value);
}

function sameIdSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length &&
    [...left].sort().every((id, index) => id === [...right].sort()[index]);
}

function completedBatchResult(batch: TransactionImportBatch): ImportTransactionDraftsResult {
  const transactionIds = readStoredIds(batch.transactionIds);
  return { ok: true, transactionIds, importedCount: transactionIds.length };
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function importTransactionDrafts(
  input: ImportTransactionDraftsInput
): Promise<ImportTransactionDraftsResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };

  const parsedInput = importDraftsSchema.safeParse(input);
  if (!parsedInput.success) return { ok: false, error: parsedInput.error.issues[0].message };
  const { ids, idempotencyKey } = parsedInput.data;

  try {
    return await runSerializable(async (db) => {
      const replay = await db.transactionImportBatch.findUnique({
        where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } }
      });
      if (replay) {
        if (!sameIdSet(readStoredIds(replay.draftIds), ids)) {
          return { ok: false, error: "This save key was already used for another selection." };
        }
        return replay.status === "IMPORTED"
          ? completedBatchResult(replay)
          : { ok: false, error: "This selection is already being saved." };
      }

      const drafts = await db.transactionDraft.findMany({
        where: { id: { in: ids }, userId: user.id, status: "READY" },
        orderBy: [{ position: "asc" }, { id: "asc" }]
      });
      if (drafts.length !== ids.length) {
        return { ok: false, error: "Review every selected draft before saving." };
      }
      const origin = drafts[0].origin;
      if (drafts.some((draft) => draft.origin !== origin)) {
        return { ok: false, error: "Save QUICK and PASTE drafts in separate batches." };
      }

      const parsedRows = drafts.map((draft) => ({
        draft,
        parsed: parseTransactionCreateInput(
          draftToTransactionInput(transactionDraftRecordToInput(draft))
        )
      }));
      const invalid = parsedRows.find(({ parsed }) => !parsed.ok);
      if (invalid && !invalid.parsed.ok) {
        return {
          ok: false,
          error: invalid.parsed.issues[0].message,
          draftId: invalid.draft.id
        };
      }
      const data = parsedRows.flatMap(({ parsed }) => parsed.ok ? [parsed.data] : []);
      const references = await loadOwnedTransactionReferences(db, user.id, data);
      const preparedRows = data.map((row, index) => ({
        draft: drafts[index],
        prepared: prepareTransactionCreate(row, references)
      }));
      const rejected = preparedRows.find(({ prepared }) => !prepared.ok);
      if (rejected && !rejected.prepared.ok) {
        return {
          ok: false,
          error: rejected.prepared.issues[0].message,
          draftId: rejected.draft.id
        };
      }

      const batch = await db.transactionImportBatch.create({
        data: { userId: user.id, idempotencyKey, origin, draftIds: ids }
      });
      const transactionIds: string[] = [];
      for (const { draft, prepared } of preparedRows) {
        if (!prepared.ok) throw new Error("Prepared draft invariant failed.");
        const locked = await db.transactionDraft.updateMany({
          where: { id: draft.id, userId: user.id, status: "READY" },
          data: { status: "IMPORTING", importBatchId: batch.id }
        });
        if (locked.count !== 1) throw new Error("Draft changed while saving.");
        const transaction = await persistPreparedTransaction(db, user.id, prepared.data);
        transactionIds.push(transaction.id);
        await db.transactionDraft.update({
          where: { id: draft.id },
          data: {
            status: "IMPORTED",
            importedTransactionId: transaction.id,
            type: null,
            amountText: null,
            currency: null,
            title: null,
            description: null,
            transactionDateText: null,
            categoryId: null,
            qualityRating: null,
            fromMoneySourceId: null,
            toMoneySourceId: null,
            adjustedMoneySourceId: null,
            adjustmentDirection: null,
            adjustmentTarget: null,
            projectId: null,
            relatedTransactionId: null,
            countTowardFeeWaiver: null,
            recurringPaymentId: null,
            isInstallmentRelated: false,
            duplicateFingerprint: null,
            duplicateConfirmed: false,
            validationIssues: [],
            rawRow: Prisma.JsonNull
          }
        });
      }
      await db.activityLog.create({
        data: {
          userId: user.id,
          action: "TRANSACTION_BATCH_IMPORTED",
          entityType: "TransactionImportBatch",
          entityId: batch.id,
          metadata: { origin, count: transactionIds.length }
        }
      });
      const completed = await db.transactionImportBatch.update({
        where: { id: batch.id },
        data: { status: "IMPORTED", transactionIds }
      });
      return completedBatchResult(completed);
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const replay = await prisma.transactionImportBatch.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } }
    });
    if (!replay || replay.status !== "IMPORTED" ||
        !sameIdSet(readStoredIds(replay.draftIds), ids)) {
      return { ok: false, error: "This save key was already used for another selection." };
    }
    return completedBatchResult(replay);
  }
}
```

`runSerializable()` retries PostgreSQL write conflicts (`P2034`). The explicit
`P2002` recovery handles two requests racing to create the same unique batch;
it returns only a completed batch with the identical draft set. A reused key
with different IDs always returns the safe conflict.

- [ ] **Step 4: Redact imported drafts and record batch metadata**

Set status `IMPORTED`, `importBatchId`, and `importedTransactionId`, then null
all candidate fields and `rawRow`. Preserve each standard
`TRANSACTION_CREATED` activity entry. Add one `TRANSACTION_BATCH_IMPORTED`
entry with metadata `{ origin, count }`; do not include draft values or IDs from
other users.

- [ ] **Step 5: Cover exact all-five-type reconciliation**

Create one batch containing INCOME, EXPENSE, TRANSFER, REFUND, and ADJUSTMENT.
Assert exact persisted fields, card debt/credit effects, category fee-waiver
default, activity count, and the absence of binary-number rounding. Add foreign
reference, not-ready draft, duplicate ID, 201-ID, rate-limit, concurrent replay,
and forced activity failure cases.

- [ ] **Step 6: Run focused and reference-ledger integration suites**

Run:

```bash
npx vitest run tests/transaction-drafts.actions.test.ts tests/activity.test.ts
npm run test:integration -- tests/integration/transaction-drafts.integration.test.ts tests/integration/reference-ledger.integration.test.ts
```

Expected: all tests PASS; failed imports leave no partial financial state.

- [ ] **Step 7: Commit atomic import**

```bash
git add lib/actions/transaction-drafts.ts lib/activity.ts tests/transaction-drafts.actions.test.ts tests/integration/transaction-drafts.integration.test.ts
git commit -m "feat: import transaction drafts atomically"
```

---

### Task 7: Add the Protected Capture Route and Navigation

**Files:**

- Create: `app/(protected)/transactions/capture/page.tsx`
- Create: `app/(protected)/transactions/capture/loading.tsx`
- Create: `tests/transaction-capture-page.test.tsx`
- Modify: `app/(protected)/transactions/page.tsx`
- Modify: `app/(protected)/transactions/loading.tsx`
- Modify: `tests/loading-states.test.tsx`

**Interfaces:**

- Produces server-rendered `TransactionCapturePage` with owned categories, money sources, projects, recent expenses, user defaults, and optional capture-session drafts.
- Consumes authenticated list actions and `listTransactionDrafts()`.

- [ ] **Step 1: Write RED page-rendering tests**

```tsx
expect(renderCapturePage()).toContain("Capture transactions");
expect(renderCapturePage()).toContain("Paste rows");
expect(renderTransactionsPage()).toContain('href="/transactions/capture"');
```

Mock all data actions and assert that foreign user IDs never enter props.

- [ ] **Step 2: Run route tests and confirm RED**

Run: `npx vitest run tests/transaction-capture-page.test.tsx tests/loading-states.test.tsx`

Expected: FAIL because the route and loading state do not exist.

- [ ] **Step 3: Implement the protected server data boundary**

Accept only a UUID `capture` search parameter; invalid values behave as a new
session. Load categories, sources, projects, recent expenses, settings, and
owned drafts in parallel. Map Prisma values to strings and plain objects before
passing them to the client workspace.

```tsx
<CaptureWorkspace
  initialCaptureKey={captureKey}
  initialDrafts={drafts}
  options={{ categories, moneySources, projects, expenses }}
  settings={{ defaultCurrency, dateFormat, numberFormat }}
/>
```

- [ ] **Step 4: Add navigation and loading skeleton**

Change the transactions header primary action to `Capture transactions` and
retain `Single entry` as the outline action to `/transactions/new`. The empty
state points to capture. Add a capture-specific skeleton containing mode tabs,
paste panel, ledger rows, and sticky summary rather than generic cards.

- [ ] **Step 5: Run page, loading, and existing transactions tests**

Run: `npx vitest run tests/transaction-capture-page.test.tsx tests/loading-states.test.tsx tests/display-settings-pages.test.tsx`

Expected: all tests PASS.

- [ ] **Step 6: Commit route wiring**

```bash
git add 'app/(protected)/transactions/capture' 'app/(protected)/transactions/page.tsx' 'app/(protected)/transactions/loading.tsx' tests/transaction-capture-page.test.tsx tests/loading-states.test.tsx
git commit -m "feat: add transaction capture route"
```

---

### Task 8: Establish the Living Ledger Visual System

**Files:**

- Modify: `app/layout.tsx`
- Modify: `tailwind.config.ts`
- Create: `components/transaction-capture/OriginStamp.tsx`
- Create: `components/transaction-capture/StatusRail.tsx`
- Create: `components/transaction-capture/CaptureWorkspace.tsx`
- Create: `tests/transaction-capture-visual.test.tsx`

**Interfaces:**

- Produces reusable provenance/status primitives and a responsive workspace shell.
- Consumes approved color, typography, copy, focus, and reduced-motion rules from the design spec.

- [ ] **Step 1: Write RED visual-contract tests**

```tsx
const markup = renderToStaticMarkup(
  <OriginStamp origin="PASTE" />
);
expect(markup).toContain("PASTE");
expect(markup).toContain("Pasted spreadsheet row");

const status = renderToStaticMarkup(
  <StatusRail status="NEEDS_REVIEW" issueCount={2} />
);
expect(status).toContain("Needs review");
expect(status).toContain("2 issues");
```

- [ ] **Step 2: Run the visual test and confirm RED**

Run: `npx vitest run tests/transaction-capture-visual.test.tsx`

Expected: FAIL because the capture primitives do not exist.

- [ ] **Step 3: Add scoped fonts and tokens**

Load Space Grotesk, Be Vietnam Pro, and IBM Plex Mono through `next/font/google`
with variable names `--font-capture-display`, `--font-capture-ui`, and
`--font-capture-data`. Extend Tailwind with `capture-canvas: #F5F7FB`,
`capture-ink: #172033`, `capture-primary: #4338CA`, `capture-ready: #087F5B`,
`capture-review: #C97912`, and `capture-error: #C92A5B`, plus corresponding
font families. Keep the existing body font and unrelated screens unchanged.

- [ ] **Step 4: Implement semantic origin and status components**

`OriginStamp` renders visible `QUICK` or `PASTE` text and an accessible expanded
label. `StatusRail` renders icon/text/count and uses color only as a redundant
signal. Neither component accepts arbitrary classes that can override semantic
colors.

- [ ] **Step 5: Build the workspace shell and deliberate motion**

Implement the header, `Quick add`/`Paste rows` tabs, privacy-safe future `Email`
disabled affordance labeled `Planned`, empty invitation, and responsive content
regions. Animate only newly parsed rows settling into place; apply
`motion-reduce:transition-none` and no ambient effects.

- [ ] **Step 6: Run visual, layout, and type checks**

Run:

```bash
npx vitest run tests/transaction-capture-visual.test.tsx tests/protected-layout.test.tsx
npm run typecheck
npm run lint
```

Expected: all checks PASS with zero lint warnings.

- [ ] **Step 7: Commit the visual system**

```bash
git add app/layout.tsx tailwind.config.ts components/transaction-capture/OriginStamp.tsx components/transaction-capture/StatusRail.tsx components/transaction-capture/CaptureWorkspace.tsx tests/transaction-capture-visual.test.tsx
git commit -m "feat: establish living ledger capture UI"
```

---

### Task 9: Build Paste Input and Column Mapping

**Files:**

- Create: `components/transaction-capture/PasteInput.tsx`
- Create: `components/transaction-capture/ColumnMapper.tsx`
- Modify: `components/transaction-capture/CaptureWorkspace.tsx`
- Create: `tests/transaction-capture.ui.test.tsx`

**Interfaces:**

- Produces parsed/mapped draft rows and a persisted capture session.
- Consumes `parsePastedTable()`, `detectColumnMapping()`, `mapParsedRows()`, and `savePasteDrafts()`.

- [ ] **Step 1: Write RED interaction tests for paste and ambiguous mapping**

```tsx
await user.click(screen.getByRole("tab", { name: "Paste rows" }));
await user.paste(screen.getByLabelText("Paste spreadsheet rows"),
  "Date\tTitle\tAmount\n2026-08-03\tCoffee\t45000");
expect(await screen.findByText("1 row detected")).toBeVisible();
expect(screen.getByLabelText("Amount column")).toHaveValue("2");
```

Add an ambiguous duplicate-header case that requires the user to choose before
`Review rows` becomes enabled.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npx vitest run tests/transaction-capture.ui.test.tsx`

Expected: FAIL because paste and mapper components do not exist.

- [ ] **Step 3: Implement the paste surface**

Use a labeled textarea, `Paste from clipboard` button, optional `.csv`/`.tsv`
file text reader, explicit size/row counters, and examples using real VND-style
content. Preserve input after parse errors. Never upload a file object or parse
money as a number.

- [ ] **Step 4: Implement the column mapper**

Render one select per canonical field, prevent the same column from mapping to
two fields, show a live three-row preview, and identify required mappings for
the selected/default transaction type. `Review rows` calls `savePasteDrafts()`
and replaces the URL with `?capture=<uuid>` only after persistence succeeds.

- [ ] **Step 5: Cover limits, file input, Unicode, server errors, and reload state**

Test 1 MB/200-row boundaries, invalid files, Vietnamese headings, a rejected
server action, and initialization from already persisted drafts. Error copy must
say exactly what the user can correct.

- [ ] **Step 6: Run focused and parser regression tests**

Run: `npx vitest run tests/transaction-capture.ui.test.tsx tests/transaction-paste.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit paste and mapping UI**

```bash
git add components/transaction-capture/PasteInput.tsx components/transaction-capture/ColumnMapper.tsx components/transaction-capture/CaptureWorkspace.tsx tests/transaction-capture.ui.test.tsx
git commit -m "feat: add spreadsheet paste mapping"
```

---

### Task 10: Build the Editable Desktop Ledger and Mobile Cards

**Files:**

- Create: `components/transaction-capture/DraftLedger.tsx`
- Create: `components/transaction-capture/DraftCards.tsx`
- Create: `components/transaction-capture/DraftInspector.tsx`
- Modify: `components/transaction-capture/CaptureWorkspace.tsx`
- Modify: `tests/transaction-capture.ui.test.tsx`

**Interfaces:**

- Produces controlled draft editing through `onPatch(id, patch)`, selection through `onSelectionChange(ids)`, and field focus through `focusIssue(id, field)`.
- Consumes serializable draft views, owned option lists, and `updateTransactionDraft()`.

- [ ] **Step 1: Add RED keyboard and responsive rendering tests**

```tsx
const amount = screen.getByRole("textbox", { name: "Row 1 amount" });
amount.focus();
await user.keyboard("{ArrowRight}");
expect(screen.getByRole("combobox", { name: "Row 1 source" })).toHaveFocus();

expect(screen.getByTestId("capture-desktop-ledger")).toHaveClass("hidden", "lg:block");
expect(screen.getByTestId("capture-mobile-cards")).toHaveClass("lg:hidden");
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npx vitest run tests/transaction-capture.ui.test.tsx`

Expected: FAIL because ledger/card/inspector components are absent.

- [ ] **Step 3: Implement a native-table desktop ledger**

Use native table semantics with controlled `Input`/`Select` controls inside
cells. Core columns are select, status rail, origin, date, type, title, amount,
source, category, quality, and details. Arrow/Tab/Enter/Escape behavior must not
trap focus or override standard select/text editing. Save patches on blur and
announce server findings through an `aria-live="polite"` summary.

- [ ] **Step 4: Implement the type-specific inspector**

Show destination for INCOME/TRANSFER/REFUND, adjusted source/direction/target
for ADJUSTMENT, related expense for REFUND, and project/description/fee-waiver
fields when applicable. Changing type clears incompatible fields in client
state, while server validation remains authoritative. For an exact repeated
row, show `Keep as a separate transaction`; checking it patches only
`duplicateConfirmed` and keeps the duplicate warning visible as acknowledged.

- [ ] **Step 5: Implement mobile cards from the same controlled state**

At widths below `lg`, render one card per draft with status/origin/title/amount
summary and an expandable editor in the same logical field order. Ensure all
targets are at least 44 pixels and the page has no minimum width or
document-level horizontal scroll.

- [ ] **Step 6: Add fill-down and multi-row selection**

Fill-down is available only for explicit user-selected fields and rows. It
calls `updateTransactionDraft()` per changed draft through a bounded sequential
queue, reports partial network failures without claiming success, and never
overwrites a field edited after the fill operation started.

Add cell-paste handling for a selected editable cell: parse a single clipboard
column, apply values down the selected rows, and route changes through that same
bounded queue. Default blank fields from user settings and the prior row only;
track touched fields so a later default or fill operation cannot overwrite an
explicit edit.

- [ ] **Step 7: Run interaction, accessibility, and existing form tests**

Run:

```bash
npx vitest run tests/transaction-capture.ui.test.tsx tests/transaction-form.ui.test.tsx tests/page-header.test.tsx
npm run typecheck
```

Expected: all checks PASS.

- [ ] **Step 8: Commit ledger editing**

```bash
git add components/transaction-capture/DraftLedger.tsx components/transaction-capture/DraftCards.tsx components/transaction-capture/DraftInspector.tsx components/transaction-capture/CaptureWorkspace.tsx tests/transaction-capture.ui.test.tsx
git commit -m "feat: edit transaction drafts responsively"
```

---

### Task 11: Add Quick Drafts and the Atomic Import Bar

**Files:**

- Create: `components/transaction-capture/ImportBar.tsx`
- Modify: `components/transaction-capture/CaptureWorkspace.tsx`
- Modify: `components/transaction-capture/DraftInspector.tsx`
- Modify: `tests/transaction-capture.ui.test.tsx`
- Modify: `app/(protected)/transactions/page.tsx`

**Interfaces:**

- Produces a compact one-row QUICK capture and final batch-selection/import interaction.
- Consumes `saveQuickDraft()`, `importTransactionDrafts()`, and draft selection/status.

- [ ] **Step 1: Write RED tests for quick defaults and import summary**

```tsx
await user.click(screen.getByRole("tab", { name: "Quick add" }));
expect(screen.getByLabelText("Date")).toHaveValue("2026-08-03");
expect(screen.getByLabelText("Currency")).toHaveValue("VND");

expect(screen.getByText("12 ready · 2 need attention")).toBeVisible();
expect(screen.getByRole("button", { name: "Save 12 transactions" })).toBeEnabled();
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npx vitest run tests/transaction-capture.ui.test.tsx`

Expected: FAIL because quick capture and import bar are incomplete.

- [ ] **Step 3: Implement compact quick capture through the draft path**

Default date/currency and last explicitly used source/category locally. Require
amount, title, and type-specific source fields before saving. Quick capture
creates one `QUICK` draft, shows it in the same review editor, and does not call
`createTransaction()` directly.

- [ ] **Step 4: Implement the sticky import summary and atomic action**

Show selected, ready, needs-review, and duplicate counts. Disable save unless
every selected row is READY and selection is non-empty. Generate one
`crypto.randomUUID()` idempotency key per user click, reuse it across network
retry, and replace it only after a successful or explicitly abandoned attempt.

- [ ] **Step 5: Handle success, retry, and failure honestly**

On success route to `/transactions?created=batch&count=<n>` and render
`Saved <n> transactions.` on the list. On a domain failure, focus the first
affected draft. On network failure retain drafts, selection, and idempotency
key, and label the action `Try saving again`.

- [ ] **Step 6: Run UI, action, and transaction-list regression tests**

Run:

```bash
npx vitest run tests/transaction-capture.ui.test.tsx tests/transaction-capture-page.test.tsx tests/transaction-drafts.actions.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit quick and import completion**

```bash
git add components/transaction-capture/ImportBar.tsx components/transaction-capture/CaptureWorkspace.tsx components/transaction-capture/DraftInspector.tsx tests/transaction-capture.ui.test.tsx 'app/(protected)/transactions/page.tsx'
git commit -m "feat: complete transaction capture workflow"
```

---

### Task 12: Close Security, Reconciliation, Documentation, and Acceptance

**Files:**

- Modify: `tests/integration/transaction-drafts.integration.test.ts`
- Modify: `tests/integration/reference-ledger.integration.test.ts`
- Modify: `tests/integration/ownership.integration.test.ts` if the shared ownership matrix is extended there
- Create: `docs/quality/transaction-capture-foundation-acceptance.md`
- Modify: `README.md`

**Interfaces:**

- Produces final Phase 1 evidence and no new runtime interface.
- Consumes all phase behavior and the repository release gates.

- [ ] **Step 1: Add the remaining whole-flow integration assertions**

Enter a deterministic five-type batch and independently calculate expected
bank balances, card debt/credit, fee-waiver eligible spend, dashboard totals,
report totals, activity rows, and CSV rows. Add two-user probes for every draft
and batch list/read/edit/dismiss/import operation. Run this focused test as an
acceptance cross-check; if it exposes a gap, open a bounded RED/GREEN fix task
before continuing.

- [ ] **Step 2: Run the complete PostgreSQL integration suite**

Run: `npm run test:integration`

Expected: every integration file passes, including atomic rollback,
idempotency, ownership, and reference-ledger reconciliation.

- [ ] **Step 3: Update setup and product documentation**

Document `Capture transactions`, paste formats, 200-row/1 MB limits, quick
capture, draft review, atomic save, and the continued availability of single
entry. State that email ingestion is not part of this phase. Do not add email
environment variables to README yet.

- [ ] **Step 4: Create the acceptance record with exact evidence**

Record automated command outputs and manual checks for:

- Excel/Sheets CSV and TSV paste;
- header mapping and malformed input recovery;
- quick capture and all five transaction types;
- exact large Decimal amount;
- fill-down and keyboard-only workflow;
- selection, retry, idempotency, and failed atomic import;
- 375-pixel mobile cards, keyboard visibility, 200-percent zoom, reduced motion,
  focus order, and no document overflow;
- two-user direct-object isolation; and
- downstream balances, cards, dashboard, reports, activity, and CSV.

- [ ] **Step 5: Run the clean final Node.js 22 gate**

Run:

```bash
npm ci
npm run verify
npm run test:integration
npm run prisma:deploy
git diff --check
git status --short
```

Expected: clean install; lint with zero warnings; typecheck; all unit/render and
integration tests pass; Prisma schema and migrations current; production audit
has zero high/critical findings; production build passes; worktree contains
only the intended documentation updates before commit.

- [ ] **Step 6: Perform browser acceptance and runtime review**

Run the application with Node.js 22 against the disposable database. Exercise
desktop Chromium, 375-pixel Chromium, keyboard-only, and reduced-motion flows.
Review console/network diagnostics and bounded runtime logs for 5xx, fatal,
Prisma, uniqueness, ownership, and unhandled errors. Record anything not
visually observed instead of inferring it.

- [ ] **Step 7: Request independent specification and quality reviews**

One reviewer compares the implementation and acceptance report with the design
and this plan. A second reviewer audits ownership, reference checks, batch
atomicity, idempotency, raw-row handling, and financial reconciliation. Resolve
Critical/Important findings through RED/GREEN tasks before closing the phase.

- [ ] **Step 8: Commit final evidence**

```bash
git add README.md docs/quality/transaction-capture-foundation-acceptance.md tests/integration/transaction-drafts.integration.test.ts tests/integration/reference-ledger.integration.test.ts tests/integration/ownership.integration.test.ts
git commit -m "docs: verify transaction capture foundation"
```

## Definition of Done

This first phase is complete only when spreadsheet and quick inputs become
owned drafts, every imported row passes the canonical transaction boundary,
selected imports are atomic and idempotent, all five transaction types
reconcile downstream, two-user isolation passes, the Living Ledger is usable at
375 pixels and by keyboard, all automated/release gates pass, and independent
review has no unresolved Critical or Important finding. Email ingestion and
Production release remain explicitly out of scope.
