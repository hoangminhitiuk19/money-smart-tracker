# Secure Inbound-Email Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free-testing inbound-email pipeline that receives only explicitly sent synthetic messages through Resend, creates reviewable `EMAIL` drafts, and never posts transactions automatically.

**Architecture:** Resend is isolated behind a provider-neutral adapter. An authenticated, user-owned mailbox service manages opaque aliases; a durable receipt state machine verifies, deduplicates, bounds, and retains webhook work; a strict synthetic parser feeds one internal server-only `EMAIL` draft builder that reuses the existing review/import boundary. Raw bodies and attachments never enter Prisma or application logs.

**Tech Stack:** Node.js 22, Next.js 15 App Router, TypeScript 5.9, React 19, Prisma 6/PostgreSQL, Zod 4, Resend SDK 6.18.1, Tailwind CSS 3, Vitest 2, Testing Library, Vercel Preview.

## Global Constraints

- Re-read `money-quality-tracker-spec-v4.md` §§5–6, 20, and 27–30; `codex-prompting-guide-v2.md` security/final gates; `docs/superpowers/specs/2026-08-03-transaction-capture-program-design.md`; and `docs/superpowers/specs/2026-08-10-secure-inbound-email-foundation-design.md` before starting each task.
- Work only on the secure inbound-email foundation. Gmail/Outlook filter onboarding, VCB/OCB/HSBC parsers, real financial email, AI, attachments, auto-posting, custom-domain setup, scheduled Production retention, and Production release are out of scope.
- Sender allowlists and forwarding-filter automation begin only in a separately approved parser/onboarding phase; this synthetic foundation does not retain or act on sender identity.
- Use only synthetic or redacted test messages. Never put raw email, subject, addresses, alias tokens, provider IDs, headers, API keys, signatures, or bodies in logs, fixtures, commits, screenshots, or activity metadata.
- Authentication remains `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. Never add or accept `AUTH_SECRET` or `AUTH_URL`.
- The optional inbound configuration group is exactly `INBOUND_EMAIL_API_KEY`, `INBOUND_EMAIL_WEBHOOK_SECRET`, and `INBOUND_EMAIL_DOMAIN`; all three must be present together.
- Every user-facing action obtains `userId` from `requireAuth()` and scopes all reads and mutations by it. The webhook never accepts a client-supplied user ID.
- An inbound message may create only a `TransactionDraft` with origin `EMAIL`. Only the existing explicit, atomic, idempotent import action may create a canonical transaction.
- Add a failing focused test before each implementation change. End every task with its focused tests, `npm run typecheck`, `git diff --check`, and a commit.
- Run all release commands under Node.js 22. Do not expose `.env` values in commands or output.

---

### Task 1: Optional inbound configuration and pinned provider dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `lib/env.ts`
- Modify: `tests/env.test.ts`
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Produces: `InboundEmailConfig` and `getInboundEmailConfig(env?: ServerEnv): InboundEmailConfig | null`.
- Produces: exact runtime dependency `resend@6.18.1`.
- Preserves: `parseServerEnv(source)` rejects `AUTH_SECRET` and `AUTH_URL`.

- [ ] **Step 1: Write failing configuration tests**

Add cases to `tests/env.test.ts` that prove the absent group is valid, the complete group is normalized, every partial group is rejected, empty secrets are rejected, schemes/paths/userinfo are rejected in the domain, and the forbidden auth aliases remain rejected:

```ts
const inbound = {
  INBOUND_EMAIL_API_KEY: "re_test_key",
  INBOUND_EMAIL_WEBHOOK_SECRET: "whsec_test_secret",
  INBOUND_EMAIL_DOMAIN: "Demo-Inbound.resend.app"
};

it("accepts a complete inbound group and normalizes its hostname", () => {
  const parsed = parseServerEnv({ ...valid, ...inbound } as NodeJS.ProcessEnv);
  expect(getInboundEmailConfig(parsed)).toEqual({
    apiKey: "re_test_key",
    webhookSecret: "whsec_test_secret",
    domain: "demo-inbound.resend.app"
  });
});

it.each(Object.keys(inbound))("rejects an inbound group missing %s", (missing) => {
  const source = { ...valid, ...inbound } as Record<string, string>;
  delete source[missing];
  expect(() => parseServerEnv(source as NodeJS.ProcessEnv)).toThrow(
    /INBOUND_EMAIL_API_KEY, INBOUND_EMAIL_WEBHOOK_SECRET, INBOUND_EMAIL_DOMAIN/
  );
});

it.each([
  "https://demo.resend.app",
  "demo.resend.app/path",
  "user@demo.resend.app",
  "demo.resend.app:443"
])("rejects unsafe inbound hostname %s", (domain) => {
  expect(() =>
    parseServerEnv({ ...valid, ...inbound, INBOUND_EMAIL_DOMAIN: domain })
  ).toThrow(/INBOUND_EMAIL_DOMAIN/);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:run -- tests/env.test.ts`

Expected: FAIL because the inbound variables and `getInboundEmailConfig` do not exist.

- [ ] **Step 3: Implement the all-or-none environment contract**

Extend `lib/env.ts` without changing existing auth names:

```ts
const databaseUrlSchema = z
  .string()
  .url()
  .refine(
    (value) =>
      value.startsWith("postgresql://") || value.startsWith("postgres://"),
    { message: "DATABASE_URL must be a PostgreSQL URL." }
  );

const nextAuthUrlSchema = z.string().url().refine(
  (value) => value.startsWith("http://") || value.startsWith("https://"),
  { message: "NEXTAUTH_URL must be an absolute HTTP(S) URL." }
);

const inboundKeys = [
  "INBOUND_EMAIL_API_KEY",
  "INBOUND_EMAIL_WEBHOOK_SECRET",
  "INBOUND_EMAIL_DOMAIN"
] as const;

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("@") &&
      !value.includes(":") &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value),
    { message: "INBOUND_EMAIL_DOMAIN must be a hostname." }
  );

const schema = z
  .object({
    DATABASE_URL: databaseUrlSchema,
    NEXTAUTH_SECRET: z.string().min(32),
    NEXTAUTH_URL: nextAuthUrlSchema,
    INBOUND_EMAIL_API_KEY: z.string().trim().min(1).optional(),
    INBOUND_EMAIL_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
    INBOUND_EMAIL_DOMAIN: hostnameSchema.optional()
  })
  .superRefine((value, context) => {
    const present = inboundKeys.filter((key) => value[key] !== undefined);
    if (present.length !== 0 && present.length !== inboundKeys.length) {
      for (const key of inboundKeys) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${inboundKeys.join(", ")} must be configured together.`
        });
      }
    }
  });

export type InboundEmailConfig = {
  apiKey: string;
  webhookSecret: string;
  domain: string;
};

export function getInboundEmailConfig(
  env: ServerEnv = getServerEnv()
): InboundEmailConfig | null {
  if (
    !env.INBOUND_EMAIL_API_KEY ||
    !env.INBOUND_EMAIL_WEBHOOK_SECRET ||
    !env.INBOUND_EMAIL_DOMAIN
  ) {
    return null;
  }
  return {
    apiKey: env.INBOUND_EMAIL_API_KEY,
    webhookSecret: env.INBOUND_EMAIL_WEBHOOK_SECRET,
    domain: env.INBOUND_EMAIL_DOMAIN
  };
}
```

These constants contain the existing refinements verbatim so their behavior and
error messages do not change.

- [ ] **Step 4: Install and pin the Resend SDK**

Run: `npm install --save-exact resend@6.18.1`

Expected: `package.json` contains `"resend": "6.18.1"`, the lockfile changes, and `npm audit --omit=dev --audit-level=high` exits 0.

- [ ] **Step 5: Update environment and repository guidance**

Append empty, documented inbound entries to `.env.example`. Update `AGENTS.md` so the inbound group is the only exception to its previous three-variable rule, while keeping `NEXTAUTH_SECRET`/`NEXTAUTH_URL` exact and forbidding both `AUTH_*` aliases. Update the README environment table and add a **Free inbound-email testing** section that says the group is optional, must be complete when enabled, accepts synthetic/redacted messages only, and does not authorize Production.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:run -- tests/env.test.ts
npm run typecheck
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all commands pass.

Commit:

```bash
git add package.json package-lock.json lib/env.ts tests/env.test.ts .env.example AGENTS.md README.md
git commit -m "chore: configure inbound email testing"
```

---

### Task 2: Owned mailbox and durable receipt schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260810000000_add_secure_inbound_email_foundation/migration.sql`
- Modify: `tests/transaction-draft-schema.test.ts`
- Create: `tests/integration/inbound-email-schema.integration.test.ts`

**Interfaces:**
- Produces Prisma enums: `InboundMailboxProvider`, `InboundMailboxStatus`, `InboundEmailReceiptState`, and `InboundEmailDisposition`.
- Produces models: `InboundMailbox` and `InboundEmailReceipt`.
- Adds: `TransactionDraft.inboundEmailReceiptId: string | null` with a unique relation.

- [ ] **Step 1: Write RED DMMF and PostgreSQL constraint tests**

Extend `tests/transaction-draft-schema.test.ts`:

```ts
it("exposes owned inbound mailbox and receipt provenance", () => {
  const models = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [model.name, model])
  );
  expect(models.has("InboundMailbox")).toBe(true);
  expect(models.has("InboundEmailReceipt")).toBe(true);
  expect(
    models.get("TransactionDraft")?.fields.some(
      ({ name, type }) => name === "inboundEmailReceiptId" && type === "String"
    )
  ).toBe(true);
});
```

Create an integration suite that creates two users and asserts:

```ts
await expect(
  prisma.inboundMailbox.create({
    data: { userId, aliasLocalPart: secondAlias }
  })
).rejects.toMatchObject({ code: "P2002" });

await expect(
  prisma.inboundEmailReceipt.create({
    data: {
      userId,
      mailboxId,
      providerEventHash: eventHash,
      providerMessageHash: repeatedMessageHash,
      expiresAt
    }
  })
).rejects.toMatchObject({ code: "P2002" });
```

Also prove user deletion cascades mailbox/receipt rows and receipt deletion sets `TransactionDraft.inboundEmailReceiptId` to null without deleting the draft.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm run test:run -- tests/transaction-draft-schema.test.ts
npm run test:integration -- tests/integration/inbound-email-schema.integration.test.ts
```

Expected: model/type failures before the schema exists.

- [ ] **Step 3: Add the exact Prisma model shape**

Add these enums and equivalent relations/indexes:

```prisma
enum InboundMailboxProvider {
  RESEND
}

enum InboundMailboxStatus {
  ACTIVE
  DISABLED
}

enum InboundEmailReceiptState {
  RECEIVED
  PROCESSING
  PROCESSED
  IGNORED
  RETRYABLE_FAILED
  TERMINAL_FAILED
}

enum InboundEmailDisposition {
  TEST_DRAFT_CREATED
  DUPLICATE
  UNSUPPORTED
  OVERSIZED
  RATE_LIMITED
  PROVIDER_ERROR
  PARSER_ERROR
}

model InboundMailbox {
  id                String                    @id @default(cuid())
  userId            String                    @unique
  provider          InboundMailboxProvider    @default(RESEND)
  aliasLocalPart    String                    @unique @db.VarChar(64)
  status            InboundMailboxStatus      @default(ACTIVE)
  lastDisposition   InboundEmailDisposition?
  lastReceivedAt    DateTime?
  createdAt         DateTime                  @default(now())
  updatedAt         DateTime                  @updatedAt
  user              User                      @relation(fields: [userId], references: [id], onDelete: Cascade)
  receipts          InboundEmailReceipt[]

  @@index([status])
}

model InboundEmailReceipt {
  id                  String                   @id @default(cuid())
  userId              String
  mailboxId           String
  providerEventHash   String                   @unique @db.Char(64)
  providerMessageHash String                   @db.Char(64)
  state               InboundEmailReceiptState @default(RECEIVED)
  disposition         InboundEmailDisposition?
  attemptCount        Int                      @default(0)
  expiresAt           DateTime
  createdAt           DateTime                 @default(now())
  updatedAt           DateTime                 @updatedAt
  user                User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  mailbox             InboundMailbox           @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  draft               TransactionDraft?

  @@unique([mailboxId, providerMessageHash])
  @@index([userId, state])
  @@index([expiresAt])
}
```

Add `inboundMailbox` and `inboundEmailReceipts` to `User`, and add this to `TransactionDraft`:

```prisma
inboundEmailReceiptId String?              @unique
inboundEmailReceipt   InboundEmailReceipt? @relation(fields: [inboundEmailReceiptId], references: [id], onDelete: SetNull)
```

- [ ] **Step 4: Write and deploy the exact migration**

Create the planned migration file with this exact enum, table, index, and
foreign-key shape:

```sql
CREATE TYPE "InboundMailboxProvider" AS ENUM ('RESEND');
CREATE TYPE "InboundMailboxStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "InboundEmailReceiptState" AS ENUM (
  'RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED',
  'RETRYABLE_FAILED', 'TERMINAL_FAILED'
);
CREATE TYPE "InboundEmailDisposition" AS ENUM (
  'TEST_DRAFT_CREATED', 'DUPLICATE', 'UNSUPPORTED', 'OVERSIZED',
  'RATE_LIMITED', 'PROVIDER_ERROR', 'PARSER_ERROR'
);

CREATE TABLE "InboundMailbox" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "InboundMailboxProvider" NOT NULL DEFAULT 'RESEND',
  "aliasLocalPart" VARCHAR(64) NOT NULL,
  "status" "InboundMailboxStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastDisposition" "InboundEmailDisposition",
  "lastReceivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundMailbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundEmailReceipt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "providerEventHash" CHAR(64) NOT NULL,
  "providerMessageHash" CHAR(64) NOT NULL,
  "state" "InboundEmailReceiptState" NOT NULL DEFAULT 'RECEIVED',
  "disposition" "InboundEmailDisposition",
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundEmailReceipt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TransactionDraft"
  ADD COLUMN "inboundEmailReceiptId" TEXT;

CREATE UNIQUE INDEX "InboundMailbox_userId_key" ON "InboundMailbox"("userId");
CREATE UNIQUE INDEX "InboundMailbox_aliasLocalPart_key" ON "InboundMailbox"("aliasLocalPart");
CREATE UNIQUE INDEX "InboundEmailReceipt_providerEventHash_key" ON "InboundEmailReceipt"("providerEventHash");
CREATE UNIQUE INDEX "InboundEmailReceipt_mailboxId_providerMessageHash_key"
  ON "InboundEmailReceipt"("mailboxId", "providerMessageHash");
CREATE UNIQUE INDEX "TransactionDraft_inboundEmailReceiptId_key"
  ON "TransactionDraft"("inboundEmailReceiptId");
CREATE INDEX "InboundMailbox_status_idx" ON "InboundMailbox"("status");
CREATE INDEX "InboundEmailReceipt_userId_state_idx"
  ON "InboundEmailReceipt"("userId", "state");
CREATE INDEX "InboundEmailReceipt_expiresAt_idx"
  ON "InboundEmailReceipt"("expiresAt");

ALTER TABLE "InboundMailbox" ADD CONSTRAINT "InboundMailbox_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundEmailReceipt" ADD CONSTRAINT "InboundEmailReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundEmailReceipt" ADD CONSTRAINT "InboundEmailReceipt_mailboxId_fkey"
  FOREIGN KEY ("mailboxId") REFERENCES "InboundMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransactionDraft" ADD CONSTRAINT "TransactionDraft_inboundEmailReceiptId_fkey"
  FOREIGN KEY ("inboundEmailReceiptId") REFERENCES "InboundEmailReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Include the ordinary indexes declared in the Prisma schema. Run
`npm run prisma:deploy`, never `prisma db push`, and inspect the applied table
definitions with the integration test rather than relying only on generated
client types.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx prisma generate
npx prisma validate
npm run test:run -- tests/transaction-draft-schema.test.ts
npm run test:integration -- tests/integration/inbound-email-schema.integration.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add prisma/schema.prisma prisma/migrations/20260810000000_add_secure_inbound_email_foundation tests/transaction-draft-schema.test.ts tests/integration/inbound-email-schema.integration.test.ts
git commit -m "feat: add inbound email persistence"
```

---

### Task 3: Provider-neutral bounds and strict synthetic parser

**Files:**
- Create: `lib/inbound-email/constants.ts`
- Create: `lib/inbound-email/types.ts`
- Create: `lib/inbound-email/bounded-reader.ts`
- Create: `lib/inbound-email/synthetic-parser.ts`
- Create: `tests/inbound-email-bounded-reader.test.ts`
- Create: `tests/inbound-email-synthetic-parser.test.ts`

**Interfaces:**
- Produces: `InboundNotification`, `InboundMessage`, `InboundEmailProvider`.
- Produces: `readBoundedRequestText(request, maximumBytes)` and `readBoundedResponseText(response, maximumBytes)`.
- Produces: `parseSyntheticInboundMessage(message): SyntheticParseResult`.
- Produces: `EmailDraftCandidate`, the ID-free candidate consumed by Task 7.

- [ ] **Step 1: Write RED bounded-reader tests**

Cover declared oversize, chunked oversize without `Content-Length`, exact-boundary UTF-8, an aborted response, and a normal response:

```ts
await expect(
  readBoundedRequestText(
    new Request("http://localhost", {
      method: "POST",
      headers: { "content-length": "256001" },
      body: "small"
    }),
    MAX_INBOUND_WEBHOOK_BYTES
  )
).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });

expect(new TextEncoder().encode(result).byteLength).toBe(
  MAX_INBOUND_WEBHOOK_BYTES
);
```

- [ ] **Step 2: Write RED strict-parser tests**

Use the exact fixture from the design. Assert extraction returns exact amount text and an `EXPENSE` candidate. Reject zero/negative/three-decimal/Decimal(18,2)-overflow amounts, invalid calendar dates, missing/duplicate/extra fields, lowercase marker/field names, blank merchant, unsupported currency length, HTML-only input, and arbitrary bank/OTP/marketing content.

```ts
expect(parseSyntheticInboundMessage({ text: fixture, html: null, attachmentCount: 0 }))
  .toEqual({
    kind: "candidate",
    candidate: {
      type: "EXPENSE",
      amountText: "125000",
      currency: "VND",
      transactionDateText: "2026-08-10",
      title: "Demo Cafe",
      description: "Synthetic inbound-email test data.",
      confidence: 100
    }
  });
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npm run test:run -- tests/inbound-email-bounded-reader.test.ts tests/inbound-email-synthetic-parser.test.ts`

- [ ] **Step 4: Implement focused contracts and constants**

Use these constants:

```ts
export const MAX_INBOUND_WEBHOOK_BYTES = 256_000;
export const MAX_INBOUND_CONTENT_BYTES = 1_000_000;
export const MAX_PROVIDER_RESPONSE_BYTES = 1_100_000;
export const INBOUND_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const INBOUND_RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
```

Define the provider interface exactly:

```ts
export type InboundNotification = {
  eventId: string;
  messageId: string;
  recipients: string[];
  occurredAt: Date;
};

export type InboundMessage = {
  text: string | null;
  html: string | null;
  attachmentCount: number;
};

export interface InboundEmailProvider {
  verifyNotification(rawBody: string, headers: Headers): InboundNotification;
  retrieveMessage(messageId: string, signal: AbortSignal): Promise<InboundMessage>;
}

export type EmailDraftCandidate = {
  type: "EXPENSE";
  amountText: string;
  currency: string;
  transactionDateText: string;
  title: string;
  description: "Synthetic inbound-email test data.";
  confidence: 100;
};

export type SyntheticParseResult =
  | { kind: "candidate"; candidate: EmailDraftCandidate }
  | { kind: "unsupported"; code: "UNSUPPORTED" };
```

Implement a streaming reader that cancels once the encoded byte limit is exceeded and throws a typed safe error containing only `code`. Never include content in an error message.

- [ ] **Step 5: Implement the exact synthetic parser**

Normalize CRLF to LF and trim surrounding whitespace. Require exactly five
non-empty lines, the uppercase marker, and exactly one each of `Amount`,
`Currency`, `Date`, and `Merchant` in that order. Validate the amount through
`parseTransactionCreateInput` using a complete `EXPENSE` probe with
`fromMoneySourceId: "synthetic-probe"` so Decimal(18,2) behavior stays
canonical. Validate the date with `parseTransactionDateRange(date, date)`
rather than `Date.parse` rollover. Do not parse HTML in this phase.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:run -- tests/inbound-email-bounded-reader.test.ts tests/inbound-email-synthetic-parser.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add lib/inbound-email tests/inbound-email-bounded-reader.test.ts tests/inbound-email-synthetic-parser.test.ts
git commit -m "feat: add bounded inbound email contracts"
```

---

### Task 4: Resend signature and retrieval adapter

**Files:**
- Create: `lib/inbound-email/resend-provider.ts`
- Create: `tests/resend-inbound-email-provider.test.ts`

**Interfaces:**
- Consumes: `InboundEmailProvider`, `InboundNotification`, `InboundMessage`, `readBoundedResponseText`, and `InboundEmailConfig`.
- Produces: `ResendInboundEmailProvider` implementing `InboundEmailProvider`.

- [ ] **Step 1: Write RED adapter tests**

Mock the SDK verifier and injected `fetch`. Prove:

- untouched raw JSON is passed to `webhooks.verify` with `svix-id`, `svix-timestamp`, and `svix-signature`;
- a missing header or failed verification throws only `INVALID_SIGNATURE`;
- only a verified `email.received` payload with UUID `email_id`, bounded recipients, and valid timestamp becomes `InboundNotification`;
- retrieval calls `GET https://api.resend.com/emails/receiving/` followed by
  `encodeURIComponent(messageId)`, with bearer API key and abort signal;
- non-2xx, malformed JSON, oversized response, combined text/HTML over 1 MB, and aborts return safe typed failures;
- attachments are counted from metadata and no attachment URL is requested.
- a correctly signed event other than `email.received` yields the typed safe
  `UNSUPPORTED_EVENT` result only after verification and performs no retrieval.

```ts
expect(verify).toHaveBeenCalledWith({
  payload: rawBody,
  headers: {
    id: "evt_verified",
    timestamp: "1786320000",
    signature: "v1,signature"
  },
  webhookSecret: "whsec_test_secret"
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:run -- tests/resend-inbound-email-provider.test.ts`

- [ ] **Step 3: Implement the adapter with injected boundaries**

Constructor shape:

```ts
type ResendWebhookVerify = (input: {
  payload: string;
  headers: { id: string; timestamp: string; signature: string };
  webhookSecret: string;
}) => unknown;

function defaultDependencies(config: InboundEmailConfig): {
  verify: ResendWebhookVerify;
  fetch: typeof fetch;
} {
  const resend = new Resend(config.apiKey);
  return {
    verify: resend.webhooks.verify.bind(resend.webhooks),
    fetch
  };
}

export class ResendInboundEmailProvider implements InboundEmailProvider {
  constructor(
    private readonly config: InboundEmailConfig,
    private readonly dependencies: {
      verify: ResendWebhookVerify;
      fetch: typeof fetch;
    } = defaultDependencies(config)
  ) {}
}
```

Use Zod schemas after successful signature verification. The webhook schema accepts only `type: "email.received"`, `created_at`, `data.email_id`, and `data.to`; `.passthrough()` may tolerate provider additions but extracted output must contain only the neutral fields. Use direct bounded `fetch` for received-email retrieval so the SDK cannot materialize an unbounded response before the application limit runs. Parse only `text`, `html`, and attachment array length.
For a verified payload whose `type` is not `email.received`, throw a typed
`UNSUPPORTED_EVENT` error. Do not validate or extract its provider-specific
`data`; Task 8 maps this safe condition to generic `200 IGNORED`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run test:run -- tests/resend-inbound-email-provider.test.ts
npm run typecheck
npm audit --omit=dev --audit-level=high
git diff --check
```

Commit:

```bash
git add lib/inbound-email/resend-provider.ts tests/resend-inbound-email-provider.test.ts
git commit -m "feat: add resend inbound adapter"
```

---

### Task 5: Authenticated mailbox lifecycle and safe activity

**Files:**
- Create: `lib/inbound-email/mailboxes.ts`
- Create: `lib/actions/inbound-email.ts`
- Create: `tests/inbound-email-mailboxes.test.ts`
- Create: `tests/inbound-email.actions.test.ts`
- Modify: `app/(protected)/activity-log/page.tsx`
- Modify: `tests/activity-log.ui.test.tsx`

**Interfaces:**
- Produces: `generateInboundAliasLocalPart(): string` and `inboundAddress(localPart, domain): string`.
- Produces: `InboundEmailSetupView`, `InboundEmailActionResult<T>`, `getInboundEmailSetup`, `createInboundMailbox`, `rotateInboundMailbox`, `enableInboundMailbox`, `disableInboundMailbox`, `deletePendingInboundEmailDrafts`, and `disconnectInboundMailbox`.

- [ ] **Step 1: Write RED alias and action tests**

Prove aliases match `/^m_[0-9a-f]{40}$/`, contain 160 random bits, compare case-insensitively, and never include the user ID/email. Mock `requireAuth`, Prisma, cleanup, rate limiting, and environment configuration. Assert:

```ts
expect(prisma.inboundMailbox.findUnique).toHaveBeenCalledWith({
  where: { userId: "user-1" }
});
expect(prisma.inboundMailbox.updateMany).toHaveBeenCalledWith({
  where: { userId: "user-1", id: "mailbox-1" },
  data: expect.objectContaining({ status: "DISABLED" })
});
```

Cover absent configuration, idempotent concurrent create, three collision retries, rotation, enable/disable, deletion of only owned editable `EMAIL` drafts, disconnect deleting those drafts plus the owned mailbox, safe generic failures, mutation rate limiting, and zero raw/alias/address values in activity metadata.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm run test:run -- tests/inbound-email-mailboxes.test.ts tests/inbound-email.actions.test.ts tests/activity-log.ui.test.tsx`

- [ ] **Step 3: Implement mailbox helpers and setup view**

Use `randomBytes(20).toString("hex")` and prefix `m_`. Define:

```ts
export type InboundEmailSetupView = {
  configured: boolean;
  mailbox: null | {
    address: string | null;
    status: "ACTIVE" | "DISABLED";
    lastDisposition: InboundEmailDisposition | null;
    lastReceivedAt: string | null;
    reviewCaptureKey: string | null;
  };
};

export type InboundEmailActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export declare function getInboundEmailSetup(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
>;
export declare function createInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
>;
export declare function rotateInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
>;
export declare function enableInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
>;
export declare function disableInboundMailbox(): Promise<
  InboundEmailActionResult<{ setup: InboundEmailSetupView }>
>;
export declare function deletePendingInboundEmailDrafts(): Promise<
  InboundEmailActionResult<{
    deletedCount: number;
    setup: InboundEmailSetupView;
  }>
>;
export declare function disconnectInboundMailbox(): Promise<
  InboundEmailActionResult<{
    deletedDraftCount: number;
    disconnected: true;
  }>
>;
```

No action accepts a user ID or mailbox ID. Create/rotate require the complete inbound configuration; privacy actions still work when configuration is absent. Return an address only when the domain is configured.
`getInboundEmailSetup` may expose only the UUID `captureKey` from the newest
owned editable `EMAIL` draft as `reviewCaptureKey`; it never returns receipt,
mailbox, provider, or user identifiers.

- [ ] **Step 4: Implement owned transactional mutations**

Every write calls `requireAuth()` and `checkAuthenticatedMutation(user.id)`. Write safe activity rows in the same transaction using these actions and metadata only:

```ts
const safeActions = [
  "INBOUND_EMAIL_CONNECTED",
  "INBOUND_EMAIL_ALIAS_ROTATED",
  "INBOUND_EMAIL_ENABLED",
  "INBOUND_EMAIL_DISABLED",
  "INBOUND_EMAIL_PENDING_DELETED",
  "INBOUND_EMAIL_DISCONNECTED",
  "INBOUND_EMAIL_RECEIVED"
] as const;
// Allowed metadata: { deletedDraftCount?: number; disposition?: string }
```

Task 5 writes the first six lifecycle actions. Reserve
`INBOUND_EMAIL_RECEIVED` for Task 8, where verified receipt processing writes it
inside the same transaction as the receipt and draft outcome.

`deletePendingInboundEmailDrafts` and disconnect target only `{ userId, origin: "EMAIL", status: { in: ["NEEDS_REVIEW", "READY"] } }`. Disconnect deletes the mailbox after drafts so receipt cascades cannot leave sensitive candidates linked.

- [ ] **Step 5: Make activity entries understandable without sensitive data**

Add the seven actions to `actionOptions` and safe summaries such as `Connected
inbound email testing`, `Received inbound email: Test draft created`, and
`Deleted 2 pending email drafts`. `INBOUND_EMAIL_RECEIVED` accepts only a known
`InboundEmailDisposition` string. Do not display an address, provider ID,
subject, sender, or alias.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:run -- tests/inbound-email-mailboxes.test.ts tests/inbound-email.actions.test.ts tests/activity-log.ui.test.tsx
npm run typecheck
git diff --check
```

Commit:

```bash
git add lib/inbound-email/mailboxes.ts lib/actions/inbound-email.ts tests/inbound-email-mailboxes.test.ts tests/inbound-email.actions.test.ts app/\(protected\)/activity-log/page.tsx tests/activity-log.ui.test.tsx
git commit -m "feat: add owned inbound mailbox controls"
```

---

### Task 6: Receipt claim state machine and bounded retention

**Files:**
- Create: `lib/inbound-email/receipts.ts`
- Create: `lib/inbound-email/retention.ts`
- Create: `tests/inbound-email-receipts.test.ts`
- Create: `tests/inbound-email-retention.test.ts`
- Create: `tests/integration/inbound-email-receipts.integration.test.ts`
- Modify: `lib/security/rate-limit.ts`
- Modify: `tests/rate-limit.test.ts`

**Interfaces:**
- Produces: `hashInboundIdentifier(provider, value)`, `findActiveMailboxForRecipient`, `claimInboundEmailReceipt`, `markInboundReceipt`, and `cleanupExpiredInboundEmailData`.
- Produces: `policies.inboundAlias` and `checkInboundEmailAlias(aliasLocalPart)`.

Use these service signatures:

```ts
export type InboundReceiptClaim =
  | {
      kind: "claimed";
      receipt: { id: string; userId: string; mailboxId: string };
    }
  | {
      kind: "duplicate";
      receipt: { id: string; userId: string; mailboxId: string };
    };

export type InboundMailboxReader = Pick<
  Prisma.TransactionClient,
  "inboundMailbox"
>;

export declare function hashInboundIdentifier(
  provider: InboundMailboxProvider,
  value: string
): string;

export declare function findActiveMailboxForRecipient(
  db: InboundMailboxReader,
  recipient: string,
  domain: string
): Promise<{
  id: string;
  userId: string;
  aliasLocalPart: string;
} | null>;

export declare function claimInboundEmailReceipt(input: {
  provider: InboundMailboxProvider;
  userId: string;
  mailboxId: string;
  eventId: string;
  messageId: string;
  now: Date;
}): Promise<InboundReceiptClaim>;

export declare function markInboundReceipt(
  db: Prisma.TransactionClient,
  input: {
    id: string;
    userId: string;
    mailboxId: string;
    state: InboundEmailReceiptState;
    disposition: InboundEmailDisposition | null;
  }
): Promise<boolean>;

export declare function cleanupExpiredInboundEmailData(
  now?: Date,
  maximumRows?: number
): Promise<{ receiptsDeleted: number; draftsDeleted: number }>;
```

- [ ] **Step 1: Write RED receipt and retention tests**

Test SHA-256 lowercase hex without exposing input, exact-domain/single-address alias resolution, active-only lookup, first claim, duplicate event, duplicate mailbox/message, claim from `RECEIVED`/`RETRYABLE_FAILED`, refusal to reclaim terminal/processing rows, attempt increments, safe state transitions, invalid maximum batch sizes, oldest-first receipt deletion, and opportunistic expired `EMAIL` draft cleanup.

```ts
expect(hashInboundIdentifier("RESEND", "provider-id")).toMatch(/^[0-9a-f]{64}$/);
expect(hashInboundIdentifier("RESEND", "provider-id")).not.toBe(
  createHash("sha256").update("provider-id").digest("hex")
);
expect(await claimInboundEmailReceipt(input)).toEqual(
  expect.objectContaining({ kind: "claimed" })
);
expect(await claimInboundEmailReceipt(input)).toEqual(
  expect.objectContaining({ kind: "duplicate" })
);
```

The PostgreSQL integration suite must run two concurrent claims for one event and two distinct event IDs carrying the same provider message ID; each pair leaves exactly one receipt.

- [ ] **Step 2: Add and test the alias rate-limit policy**

Add:

```ts
inboundAlias: {
  scope: "inbound-email:alias",
  limit: 60,
  windowMs: 10 * 60_000
}
```

`checkInboundEmailAlias(aliasLocalPart)` delegates to `checkPolicy`; the existing rate-limit core hashes the alias with `NEXTAUTH_SECRET`. Test allowed, denied, and unavailable decisions without printing identifiers.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm run test:run -- tests/inbound-email-receipts.test.ts tests/inbound-email-retention.test.ts tests/rate-limit.test.ts
npm run test:integration -- tests/integration/inbound-email-receipts.integration.test.ts
```

- [ ] **Step 4: Implement recipient resolution and atomic claiming**

Parse exactly one address consisting of the alias local part, one `@`, and the
configured domain; lowercase both for lookup and reject display-name syntax,
multiple addresses, CR/LF, userinfo, or another domain. Query only:

```ts
where: {
  aliasLocalPart: localPart,
  status: InboundMailboxStatus.ACTIVE
}
```

Hash the UTF-8 sequence `provider`, one NUL byte, and identifier before Prisma
calls so IDs from future providers cannot collide. Create with
`expiresAt = now + INBOUND_RECEIPT_RETENTION_MS`. On `P2002`, query by event
hash first and then `(mailboxId, messageHash)`. Claim only safe retryable states
with `updateMany`; an already processing/terminal row is a duplicate response.

- [ ] **Step 5: Implement safe state transitions and cleanup**

`markInboundReceipt` accepts only a receipt/user/mailbox triple and updates state/disposition through explicit allowed transitions. `cleanupExpiredInboundEmailData(now, maximumRows = 500)` validates `1..500`, deletes the oldest eligible receipt IDs, then calls `cleanupExpiredTransactionDrafts(now, maximumRows)`. It returns `{ receiptsDeleted, draftsDeleted }`. It never deletes `IMPORTING` or `IMPORTED` drafts.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:run -- tests/inbound-email-receipts.test.ts tests/inbound-email-retention.test.ts tests/rate-limit.test.ts
npm run test:integration -- tests/integration/inbound-email-receipts.integration.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add lib/inbound-email/receipts.ts lib/inbound-email/retention.ts lib/security/rate-limit.ts tests/inbound-email-receipts.test.ts tests/inbound-email-retention.test.ts tests/rate-limit.test.ts tests/integration/inbound-email-receipts.integration.test.ts
git commit -m "feat: add inbound receipt lifecycle"
```

---

### Task 7: Server-only `EMAIL` draft boundary

**Files:**
- Create: `lib/inbound-email/email-drafts.ts`
- Create: `tests/inbound-email-drafts.test.ts`
- Modify: `lib/transaction-drafts/types.ts`
- Modify: `lib/actions/transaction-drafts.ts`
- Modify: `tests/transaction-drafts.actions.test.ts`
- Create: `tests/integration/inbound-email-drafts.integration.test.ts`

**Interfaces:**
- Consumes: `EmailDraftCandidate` from Task 3.
- Produces: `createEmailDraftFromCandidate(db, input)`.
- Produces: `storedTransactionDraftInputSchema`, which accepts persisted `QUICK`, `PASTE`, or `EMAIL` records.
- Preserves: `transactionDraftInputSchema` accepts client-created `QUICK`/`PASTE` only.

- [ ] **Step 1: Write RED schema and action-boundary tests**

Prove the public save schemas/actions reject client-supplied `origin: EMAIL`, while editing an owned existing `EMAIL` draft succeeds:

```ts
expect(
  transactionDraftInputSchema.safeParse({ ...validDraft, origin: "EMAIL" }).success
).toBe(false);
expect(
  storedTransactionDraftInputSchema.safeParse({ ...validDraft, origin: "EMAIL" }).success
).toBe(true);
```

Add action tests ensuring another user receives the existing safe not-found response and mixed-origin imports remain rejected without naming only Quick/Paste.
Also prove dismissal and successful import immediately replace every
email-derived candidate field with cleared/null lifecycle-safe values while
retaining only the draft/receipt provenance required for idempotency and audit.

- [ ] **Step 2: Write RED internal-builder tests**

Mock a Prisma transaction client and assert one verified receipt produces one draft:

```ts
expect(createData).toEqual(
  expect.objectContaining({
    userId: "user-1",
    origin: "EMAIL",
    inboundEmailReceiptId: "receipt-1",
    type: "EXPENSE",
    amountText: "125000",
    currency: "VND",
    title: "Demo Cafe",
    status: "NEEDS_REVIEW",
    rawRow: Prisma.DbNull
  })
);
```

Assert `expiresAt` is exactly 30 days from the injected clock, the missing source produces a canonical `fromMoneySourceId` issue, no transaction write occurs, and a replay returns the existing draft/capture key.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npm run test:run -- tests/inbound-email-drafts.test.ts tests/transaction-drafts.actions.test.ts`

- [ ] **Step 4: Split persisted validation from public creation validation**

Keep the current schema name and public behavior. Add:

```ts
export const storedTransactionDraftInputSchema =
  transactionDraftInputSchema.extend({
    origin: z.nativeEnum(TransactionDraftOrigin)
  });
```

Use `storedTransactionDraftInputSchema` only when merging a patch into an already-owned stored draft. Continue using `transactionDraftInputSchema` in `saveQuickDraft` and `savePasteDrafts`.

- [ ] **Step 5: Implement the internal builder**

Exact signature:

```ts
export declare function createEmailDraftFromCandidate(
  db: Prisma.TransactionClient,
  input: {
    userId: string;
    mailboxId: string;
    aliasLocalPart: string;
    receiptId: string;
    candidate: EmailDraftCandidate;
    now: Date;
  }
): Promise<{ draftId: string; captureKey: string; created: boolean }>;
```

Re-read the receipt with its mailbox and require matching user, mailbox, active status, and current alias inside the transaction. Return an existing draft by unique receipt relation on replay. Otherwise create a UUID capture key and position 0, call `assessDraft` with empty owned-reference collections, persist its exact issues/status, set confidence from the candidate, set `rawRow` to `Prisma.DbNull`, and set the 30-day expiry. Do not accept category/source/project/transaction IDs in `EmailDraftCandidate`.

- [ ] **Step 6: Add PostgreSQL ownership and financial-zero-effect proof**

The integration suite creates two users, attempts cross-user receipt/draft combinations, concurrently replays one receipt, and asserts one owned draft. Snapshot counts and representative balance/report/card calculations before and after receipt/draft creation; all canonical transaction and financial results must remain unchanged until explicit import. Then edit the source, import through `importTransactionDrafts`, and assert the normal transaction/activity boundary is used exactly once.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run test:run -- tests/inbound-email-drafts.test.ts tests/transaction-drafts.actions.test.ts
npm run test:integration -- tests/integration/inbound-email-drafts.integration.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add lib/inbound-email/email-drafts.ts lib/transaction-drafts/types.ts lib/actions/transaction-drafts.ts tests/inbound-email-drafts.test.ts tests/transaction-drafts.actions.test.ts tests/integration/inbound-email-drafts.integration.test.ts
git commit -m "feat: add verified email draft boundary"
```

---

### Task 8: Signed webhook orchestration and route

**Files:**
- Create: `lib/inbound-email/webhook.ts`
- Create: `app/api/webhooks/inbound-email/route.ts`
- Create: `tests/inbound-email-webhook.test.ts`
- Create: `tests/inbound-email-webhook.route.test.ts`
- Create: `tests/integration/inbound-email-webhook.integration.test.ts`

**Interfaces:**
- Consumes: provider adapter, bounded reader, mailbox resolver, rate limiter, receipt service, parser, draft builder, retention, and Prisma.
- Produces: `handleInboundEmailWebhook(input, dependencies)` and App Router `POST(request)`.

Use this dependency contract so tests can prove ordering without network calls:

```ts
export type InboundWebhookDependencies = {
  provider: InboundEmailProvider;
  now: () => Date;
  resolveMailbox: typeof findActiveMailboxForRecipient;
  claimReceipt: typeof claimInboundEmailReceipt;
  checkAliasRateLimit: typeof checkInboundEmailAlias;
  parseMessage: typeof parseSyntheticInboundMessage;
  createDraft: typeof createEmailDraftFromCandidate;
  markReceipt: typeof markInboundReceipt;
  cleanup: typeof cleanupExpiredInboundEmailData;
  runTransaction: <T>(
    operation: (db: Prisma.TransactionClient) => Promise<T>
  ) => Promise<T>;
  timeoutMs: number;
};

export declare function createInboundWebhookDependencies(
  provider: InboundEmailProvider
): InboundWebhookDependencies;
```

- [ ] **Step 1: Write RED orchestration-order tests**

Use spies that append call names. Invalid signature must produce exactly `['verify']`; unknown alias must produce `['verify', 'resolve']`; rate-limited alias must not retrieve or parse; a valid fixture must follow:

```ts
expect(calls).toEqual([
  "verify",
  "resolve",
  "claim",
  "rate-limit",
  "retrieve",
  "parse",
  "create-draft",
  "complete"
]);
```

Cover unexpected signed event, multiple recipients, duplicate, disabled/rotated during processing, provider timeout, retryable database failure, unsupported body, oversized content, parser exception, safe activity metadata, and cleanup failure that is logged only by error class/code.
The unexpected signed event must map the adapter's `UNSUPPORTED_EVENT` to
generic `200 IGNORED` without alias lookup, receipt creation, retrieval, or
content parsing.

- [ ] **Step 2: Write RED route tests**

Mock environment/provider/orchestrator. Prove 256 KB declared and streamed limits, configuration-disabled `503`, `runtime = "nodejs"`, signature/malformed/oversize status mapping (`401`, `400`, `413`), retryable `503`, and generic `200` bodies that never contain aliases or user information.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npm run test:run -- tests/inbound-email-webhook.test.ts tests/inbound-email-webhook.route.test.ts`

- [ ] **Step 4: Implement orchestration with injected dependencies**

Define:

```ts
export declare function handleInboundEmailWebhook(
  input: { rawBody: string; headers: Headers; domain: string },
  dependencies: InboundWebhookDependencies
): Promise<InboundWebhookResult>;

export type InboundWebhookResult = {
  status: 200 | 400 | 401 | 413 | 503;
  code:
    | "ACCEPTED"
    | "IGNORED"
    | "DUPLICATE"
    | "INVALID"
    | "OVERSIZED"
    | "RETRY";
};
```

Verify before any side effect. Require one recipient. Resolve active alias, durably claim, rate-limit, retrieve with an `AbortController` timeout, enforce combined content bytes, parse, and run draft/receipt/mailbox/activity updates in one Prisma transaction. Recheck current alias/status in that transaction. Mark transient provider/database failures `RETRYABLE_FAILED`; terminal content/parser failures store only enum disposition. On duplicate update only safe mailbox latest status if ownership is already known; never overwrite the original receipt disposition.

- [ ] **Step 5: Implement the thin route**

```ts
export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getInboundEmailConfig();
  if (!config) return safeJson(503, "Inbound email is unavailable.");
  const rawBody = await readBoundedRequestText(
    request,
    MAX_INBOUND_WEBHOOK_BYTES
  );
  const provider = new ResendInboundEmailProvider(config);
  const result = await handleInboundEmailWebhook(
    { rawBody, headers: request.headers, domain: config.domain },
    createInboundWebhookDependencies(provider)
  );
  return safeJson(result.status, genericMessage(result.code));
}
```

Map only typed safe errors. Unexpected exceptions log `{ errorClass }` and return generic `503`; never serialize exception messages.

- [ ] **Step 6: Add real-PostgreSQL retry/replay/concurrency integration**

Use a fake provider but real Prisma. Prove two concurrent valid calls create one receipt/draft/activity, a retry after injected provider failure resumes the same receipt, rotation between retrieval and transaction blocks the draft, another user's alias cannot be inferred, and raw fixture strings do not appear in any JSON/text column queried from `InboundMailbox`, `InboundEmailReceipt`, `TransactionDraft.rawRow`, or `ActivityLog.metadata`.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run test:run -- tests/inbound-email-webhook.test.ts tests/inbound-email-webhook.route.test.ts
npm run test:integration -- tests/integration/inbound-email-webhook.integration.test.ts
npm run typecheck
git diff --check
```

Commit:

```bash
git add lib/inbound-email/webhook.ts app/api/webhooks/inbound-email/route.ts tests/inbound-email-webhook.test.ts tests/inbound-email-webhook.route.test.ts tests/integration/inbound-email-webhook.integration.test.ts
git commit -m "feat: receive signed inbound email webhooks"
```

---

### Task 9: Accessible free-testing setup experience

**Files:**
- Create: `components/transaction-capture/CaptureMethodNav.tsx`
- Create: `components/inbound-email/EmailSetupPanel.tsx`
- Create: `app/(protected)/transactions/capture/email/page.tsx`
- Create: `app/(protected)/transactions/capture/email/loading.tsx`
- Modify: `app/(protected)/transactions/capture/page.tsx`
- Modify: `app/(protected)/transactions/page.tsx`
- Create: `tests/inbound-email-page.test.tsx`
- Create: `tests/inbound-email-ui.test.tsx`
- Modify: `tests/transaction-capture-page.test.tsx`
- Modify: `tests/loading-states.test.tsx`

**Interfaces:**
- Consumes: all Task 5 actions and `InboundEmailSetupView`.
- Produces: protected `/transactions/capture/email` and a shared capture-method navigation.

- [ ] **Step 1: Write RED server-render and navigation tests**

Mock `getInboundEmailSetup` and assert the page passes only the serialized setup view to `EmailSetupPanel`, contains no user ID, and links manual capture and email setup in both capture routes. Add a discoverable `Email forwarding` action on `/transactions`. Test the loading skeleton includes a labelled heading and bounded cards.

- [ ] **Step 2: Write RED interaction/accessibility tests**

Using Testing Library and user-event, cover:

- testing-only, no-mailbox-access, synthetic/redacted-only, and Resend 30-day copy;
- create and clipboard copy with accessible live confirmation;
- exact synthetic fixture and copy button;
- configured/unconfigured, waiting, received, duplicate, unsupported, rejected, delayed, active, and disabled states using text/icons rather than color alone;
- link to `/transactions/capture?capture=` followed by the returned capture UUID
  when a test draft exists;
- rotate, enable/disable, delete pending, and disconnect confirmations;
- focus returns to the trigger after cancel and moves to the status heading after success;
- repeated submit is blocked while pending and action errors stay inside the dialog;
- every interactive target has `min-h-11` on mobile, reduced-motion classes are present, and the layout has no fixed width exceeding a 375px viewport.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm run test:run -- tests/inbound-email-page.test.tsx tests/inbound-email-ui.test.tsx tests/transaction-capture-page.test.tsx tests/loading-states.test.tsx
```

- [ ] **Step 4: Implement isolated capture navigation and server page**

`CaptureMethodNav` exposes two links: `Quick and paste` to `/transactions/capture` and `Email forwarding` to `/transactions/capture/email`, with `aria-current` on the active item. Wrap the existing workspace without editing its internal behavior. The email page loads `getInboundEmailSetup()` and passes only its safe view to the client panel.

- [ ] **Step 5: Implement the client panel with exact safety copy**

The top notice must say:

```text
Testing only — use synthetic or redacted information. Money Smart Tracker cannot browse your mailbox; it receives only messages sent to this private address. Resend may retain received email for up to 30 days.
```

Display the exact fixture from the design. Use existing `Button`, `Card`, `ConfirmDialog`, and focus-visible conventions. Do not place an address in an aria-label, toast, URL, log, analytics field, or error. Clipboard status may say only `Test address copied.` Destructive dialogs state exact effects and counts without exposing IDs.
When `setup.mailbox.reviewCaptureKey` is present, build the review link from
that safe UUID only; never expose a receipt, mailbox, user, or provider ID to the
client.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:run -- tests/inbound-email-page.test.tsx tests/inbound-email-ui.test.tsx tests/transaction-capture-page.test.tsx tests/loading-states.test.tsx
npm run typecheck
npm run build
git diff --check
```

Commit:

```bash
git add components/transaction-capture/CaptureMethodNav.tsx components/inbound-email/EmailSetupPanel.tsx app/\(protected\)/transactions/capture app/\(protected\)/transactions/page.tsx tests/inbound-email-page.test.tsx tests/inbound-email-ui.test.tsx tests/transaction-capture-page.test.tsx tests/loading-states.test.tsx
git commit -m "feat: add inbound email testing setup"
```

---

### Task 10: Complete verification, Preview acceptance, and evidence

**Files:**
- Create: `docs/quality/secure-inbound-email-foundation-acceptance.md`
- Modify: `README.md`
- Modify: `AGENTS.md` only if final file paths or commands differ from Task 1 documentation
- Modify: tests or implementation files only for defects reproduced by a failing test

**Interfaces:**
- Consumes: the complete phase.
- Produces: exact local, PostgreSQL, migration, security, privacy, accessibility, and Vercel Preview evidence.

- [ ] **Step 1: Run the clean local release gate under Node.js 22**

Run:

```bash
npm ci
npm run verify
npm run test:integration
npm run prisma:deploy
git diff --check
```

Expected: lint and typecheck pass; all unit/rendered and PostgreSQL tests pass; Prisma validates; production audit reports zero high/critical vulnerabilities; build includes `/transactions/capture/email` and `/api/webhooks/inbound-email`; every migration is applied with none pending. Restore only generated `next-env.d.ts`/`tsconfig.tsbuildinfo` changes after recording results.

- [ ] **Step 2: Perform an explicit security/privacy audit**

Inspect all new actions, the webhook route, Prisma queries, logs, activity metadata, tests, and documentation. Record evidence that signature verification precedes parsing/lookup/API calls; no action accepts user identity; every owned query includes `userId`; aliases are random and rotatable; no raw content/address/provider ID is persisted or logged; attachments are never fetched; client input cannot forge `EMAIL`; retries are idempotent; and receipt/draft creation has zero financial effect.

Run repository scans and manually inspect every hit:

```bash
rg -n "AUTH_SECRET|AUTH_URL" . -g '!node_modules' -g '!.next'
rg -n "console\.(log|error|warn)|subject|rawBody|aliasLocalPart|messageId|sender|from:" lib/inbound-email lib/actions/inbound-email.ts app/api/webhooks/inbound-email
```

The only `AUTH_*` hits must be explicit forbidden-variable checks/tests/docs. Logging hits may contain only fixed text plus safe error class/code.

- [ ] **Step 3: Configure free Resend Preview testing when credentials are available**

The repository owner performs the account-only steps if no Resend account exists:

1. Create a free Resend account and open **Emails → Receiving**.
2. Copy the assigned `*.resend.app` receiving domain.
3. Copy the exact Vercel Preview deployment URL, append
   `/api/webhooks/inbound-email`, and create a webhook subscribed only to
   `email.received` at that complete HTTPS URL.
4. Add the Resend API key, returned webhook signing secret, and managed domain to Vercel Preview as `INBOUND_EMAIL_API_KEY`, `INBOUND_EMAIL_WEBHOOK_SECRET`, and `INBOUND_EMAIL_DOMAIN`.
5. Redeploy Preview. Never paste secret values into chat, git, screenshots, or the acceptance record.

If credentials are unavailable, mark only this external live gate pending; do not claim the phase complete.

- [ ] **Step 4: Run Preview acceptance with synthetic data only**

Verify by keyboard at desktop and 375px mobile:

1. Create a test address and copy it.
2. Send the exact synthetic fixture.
3. Observe one received status and one reviewable `EMAIL` draft.
4. Replay the webhook in Resend and observe duplicate suppression.
5. Edit the draft's owned source, import it, and observe exactly one transaction.
6. Rotate the alias; prove the old address no longer creates a draft.
7. Disable/enable, delete pending drafts, and disconnect.
8. Confirm status never relies only on color, focus remains visible, targets are at least 44px, reduced motion works, and there is no 375px document overflow.
9. Query only schema columns/metadata necessary to prove raw body, HTML, subject, forwarding address, and provider IDs are absent.

- [ ] **Step 5: Write exact acceptance evidence**

The acceptance document records commit, date, Node version, exact test file/test counts, integration counts, migration count, audit result, route/build count, Preview URL, synthetic flow results, privacy query results, accessibility checks, review findings, and unresolved external limitations. It must explicitly state that Gmail/Outlook onboarding, bank parsers, real email, custom domain, scheduled deletion SLA, and Production remain unfinished.

- [ ] **Step 6: Request independent two-stage review and fix only reproduced findings**

Run a specification-compliance review against the two design documents, then a security/code-quality review. For every finding, reproduce it with a failing focused test before changing implementation. Rerun that task's focused tests and the complete release gate after the final fix.

- [ ] **Step 7: Commit final evidence**

Run: `git status --short` and confirm only intended documentation or test-backed fixes remain.

Commit:

```bash
git add docs/quality/secure-inbound-email-foundation-acceptance.md README.md AGENTS.md
git commit -m "docs: verify secure inbound email foundation"
```

If review fixes were required, stage each exact implementation and test path
shown by `git status --short` in a separate `git add` command before this
commit. Never use `git add .` for the final evidence commit.

Do not push, open a pull request, or merge until the complete gate and both final reviews are clean.
