import { createHash, randomUUID } from "node:crypto";
import {
  InboundEmailReceiptState,
  MoneySourceType,
  TransactionDraftStatus,
  TransactionType
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dismissTransactionDrafts,
  importTransactionDrafts,
  updateTransactionDraft
} from "@/lib/actions/transaction-drafts";
import {
  disableInboundMailbox,
  disconnectInboundMailbox,
  rotateInboundMailbox
} from "@/lib/actions/inbound-email";
import { loadIncomeVsExpenseOverTime } from "@/lib/actions/reports";
import { calculateAccountProjection } from "@/lib/calc/dashboard";
import { calculateCreditCardState } from "@/lib/calc/credit-card";
import { createEmailDraftFromCandidate } from "@/lib/inbound-email/email-drafts";
import type { EmailDraftCandidate } from "@/lib/inbound-email/types";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "synthetic-email-draft@audit.invalid",
    name: "Synthetic email draft user"
  }))
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    getInboundEmailConfig: vi.fn(() => ({
      apiKey: "synthetic-api-key",
      webhookSecret: "synthetic-webhook-secret",
      domain: "inbound.audit.invalid"
    }))
  };
});

let context: AuditContext;
const contexts: AuditContext[] = [];
const concurrencyUserIds: string[] = [];

function opaqueHash(label: string) {
  return createHash("sha256")
    .update(`${label}:${randomUUID()}`, "utf8")
    .digest("hex");
}

function aliasLocalPart() {
  return `m_${randomUUID().replaceAll("-", "")}`;
}

function candidate(title: string): EmailDraftCandidate {
  return {
    type: "EXPENSE",
    amountText: "125000",
    currency: "VND",
    transactionDateText: "2026-08-10",
    title,
    description: "Synthetic inbound-email test data.",
    confidence: 100
  };
}

async function createReceipt(
  userId: string,
  mailboxId: string,
  now: Date
) {
  return prisma.inboundEmailReceipt.create({
    data: {
      userId,
      mailboxId,
      providerEventHash: opaqueHash("event"),
      providerMessageHash: opaqueHash("message"),
      state: InboundEmailReceiptState.PROCESSING,
      attemptCount: 1,
      expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000)
    },
    select: { id: true }
  });
}

type GateEvent = "UPDATE" | "DELETE";
type GateCleanup = () => Promise<void>;

const TEST_GATE_NAMESPACE_MIN = 219_701;
const TEST_GATE_NAMESPACE_MAX = 219_707;

function sqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function sqlIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function databaseGateCleanup(
  tableName: "InboundMailbox" | "TransactionDraft",
  triggerName: string,
  functionName: string
): GateCleanup {
  return async () => {
    let firstError: unknown;

    try {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${sqlIdentifier(triggerName)} ON ${sqlIdentifier(tableName)}`
      );
    } catch (error) {
      firstError = error;
    }
    try {
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${sqlIdentifier(functionName)}()`
      );
    } catch (error) {
      firstError ??= error;
    }

    if (firstError) throw firstError;
  };
}

async function installMailboxLifecycleGate(
  mailboxId: string,
  event: GateEvent,
  gateNamespace: number,
  gateKey: number,
  markerNamespace: number,
  markerKey: number
) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `gate_inbound_mailbox_${suffix}`;
  const triggerName = `gate_inbound_mailbox_trigger_${suffix}`;
  const rowId = sqlLiteral(mailboxId);
  const cleanup = databaseGateCleanup(
    "InboundMailbox",
    triggerName,
    functionName
  );
  let functionCreated = false;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."id" = '${rowId}' THEN
          PERFORM pg_advisory_xact_lock(${markerNamespace}, ${markerKey});
          PERFORM pg_advisory_xact_lock(${gateNamespace}, ${gateKey});
        END IF;
        RETURN ${event === "UPDATE" ? "NEW" : "OLD"};
      END;
      $$;
    `);
    functionCreated = true;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE ${event} ON "InboundMailbox"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    return cleanup;
  } catch (error) {
    if (functionCreated) {
      try {
        await cleanup();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Lifecycle gate installation and cleanup failed."
        );
      }
    }
    throw error;
  }
}

async function installDraftInsertGate(
  receiptId: string,
  gateNamespace: number,
  gateKey: number,
  markerNamespace: number,
  markerKey: number
) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `gate_email_draft_insert_${suffix}`;
  const triggerName = `gate_email_draft_insert_trigger_${suffix}`;
  const ownedReceiptId = sqlLiteral(receiptId);
  const cleanup = databaseGateCleanup(
    "TransactionDraft",
    triggerName,
    functionName
  );
  let functionCreated = false;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."inboundEmailReceiptId" = '${ownedReceiptId}' THEN
          PERFORM pg_advisory_xact_lock(${markerNamespace}, ${markerKey});
          PERFORM pg_advisory_xact_lock(${gateNamespace}, ${gateKey});
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    functionCreated = true;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "TransactionDraft"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);
    return cleanup;
  } catch (error) {
    if (functionCreated) {
      try {
        await cleanup();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Draft gate installation and cleanup failed."
        );
      }
    }
    throw error;
  }
}

async function waitForAdvisoryLock(namespace: number, key: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ held: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = ${namespace}::oid
          AND objid = ${key}::oid
          AND objsubid = 2
          AND granted
      ) AS "held"
    `;
    if (row?.held) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the deterministic lifecycle gate.");
}

async function waitForMailboxLockWaiter() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND query LIKE '%FROM "InboundMailbox"%'
          AND query LIKE '%FOR UPDATE%'
          AND wait_event_type = 'Lock'
      ) AS "waiting"
    `;
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the owned mailbox row lock.");
}

function holdAdvisoryGate(
  namespace: number,
  key: number,
  options: { timeoutMs?: number } = {}
) {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 20_000));
  let release: () => void = () => undefined;
  let signalHeld: () => void = () => undefined;
  let signalHeldFailure: (error: unknown) => void = () => undefined;
  let heldSettled = false;
  let releasedSettled = false;
  const held = new Promise<void>((resolve, reject) => {
    signalHeld = resolve;
    signalHeldFailure = reject;
  });
  const released = new Promise<void>((resolve) => {
    release = () => {
      if (releasedSettled) return;
      releasedSettled = true;
      resolve();
    };
  });
  const completion = prisma.$transaction(
    async (db) => {
      await db.$executeRawUnsafe(
        `SET LOCAL lock_timeout = '${timeoutMs}ms'`
      );
      await db.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(${namespace}, ${key})`
      );
      heldSettled = true;
      signalHeld();
      await released;
    },
    { timeout: timeoutMs + 1_000 }
  );
  void completion.then(
    () => {
      if (heldSettled) return;
      heldSettled = true;
      signalHeldFailure(
        new Error("Advisory gate completed before acquiring its lock.")
      );
    },
    (error) => {
      if (!heldSettled) {
        heldSettled = true;
        signalHeldFailure(error);
      }
      release();
    }
  );

  return { held, release, completion };
}

async function createConcurrencyFixture(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `email-draft-${label}-${randomUUID()}@audit.invalid`,
      name: "Synthetic concurrency user",
      passwordHash: "synthetic-non-authenticated-test-hash"
    },
    select: { id: true }
  });
  concurrencyUserIds.push(user.id);
  authState.userId = user.id;
  const now = new Date("2026-08-12T12:00:00.000Z");
  const mailbox = await prisma.inboundMailbox.create({
    data: {
      userId: user.id,
      aliasLocalPart: aliasLocalPart()
    }
  });
  const receipt = await createReceipt(user.id, mailbox.id, now);
  const input = {
    userId: user.id,
    mailboxId: mailbox.id,
    aliasLocalPart: mailbox.aliasLocalPart,
    receiptId: receipt.id,
    candidate: candidate(`Synthetic concurrent merchant ${randomUUID()}`),
    now
  };

  return { userId: user.id, mailbox, receipt, input };
}

async function financialSnapshot(
  userId: string,
  bank: Awaited<ReturnType<typeof prisma.moneySource.create>>,
  card: Awaited<ReturnType<typeof prisma.moneySource.create>>
) {
  const transactions = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ transactionDate: "asc" }, { id: "asc" }]
  });
  const report = await loadIncomeVsExpenseOverTime({
    startDate: "2026-08-01",
    endDate: "2026-08-31"
  });
  const cardState = calculateCreditCardState(card, transactions);

  return {
    transactionCount: transactions.length,
    bankBalance: calculateAccountProjection(bank, transactions).trackedAmount.toFixed(2),
    cardDebt: cardState.outstandingDebt.toFixed(2),
    cardCredit: cardState.cardCredit.toFixed(2),
    report: report.map(({ period, income, expense }) => ({
      period,
      income: income.toFixed(2),
      expense: expense.toFixed(2)
    }))
  };
}

type TestGateResources = {
  advisoryLocks: Array<{ pid: number }>;
  functions: Array<{ name: string }>;
  triggers: Array<{ name: string; tableName: string }>;
};

async function inspectTestGateResources(): Promise<TestGateResources> {
  const [advisoryLocks, functions, triggers] = await Promise.all([
    prisma.$queryRaw<Array<{ pid: number }>>`
      SELECT DISTINCT pid
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND classid::bigint BETWEEN ${TEST_GATE_NAMESPACE_MIN} AND ${TEST_GATE_NAMESPACE_MAX}
        AND objsubid = 2
        AND database = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
        AND pid <> pg_backend_pid()
    `,
    prisma.$queryRaw<Array<{ name: string }>>`
      SELECT procedure.proname AS "name"
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = current_schema()
        AND (
          procedure.proname LIKE 'gate_inbound_mailbox_%'
          OR procedure.proname LIKE 'gate_email_draft_insert_%'
        )
    `,
    prisma.$queryRaw<Array<{ name: string; tableName: string }>>`
      SELECT trigger.tgname AS "name", relation.relname AS "tableName"
      FROM pg_trigger AS trigger
      JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND (
          trigger.tgname LIKE 'gate_inbound_mailbox_trigger_%'
          OR trigger.tgname LIKE 'gate_email_draft_insert_trigger_%'
        )
    `
  ]);

  return { advisoryLocks, functions, triggers };
}

async function recoverTestGateResources(resources: TestGateResources) {
  const cleanupErrors: unknown[] = [];

  for (const { pid } of resources.advisoryLocks) {
    try {
      await prisma.$queryRaw`
        SELECT pg_terminate_backend(${pid})
      `;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count"
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND classid::bigint BETWEEN ${TEST_GATE_NAMESPACE_MIN} AND ${TEST_GATE_NAMESPACE_MAX}
        AND objsubid = 2
        AND database = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
        AND pid <> pg_backend_pid()
    `;
    if (row?.count === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  for (const trigger of resources.triggers) {
    try {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${sqlIdentifier(trigger.name)} ON ${sqlIdentifier(trigger.tableName)}`
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const gateFunction of resources.functions) {
    try {
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${sqlIdentifier(gateFunction.name)}()`
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  return cleanupErrors.length;
}

beforeAll(async () => {
  context = await createAuditContext(`email-draft-${randomUUID()}`);
  contexts.push(context);
  authState.userId = context.userA.id;
});

afterEach(async () => {
  const leftovers = await inspectTestGateResources();
  const found = {
    advisoryLocks: leftovers.advisoryLocks.length,
    functions: leftovers.functions.length,
    triggers: leftovers.triggers.length
  };
  if (found.advisoryLocks + found.functions + found.triggers === 0) return;

  const cleanupErrors = await recoverTestGateResources(leftovers);
  const remaining = await inspectTestGateResources();
  throw new Error(
    `Recovered leaked test gate resources (locks=${found.advisoryLocks}, functions=${found.functions}, triggers=${found.triggers}, cleanupErrors=${cleanupErrors}); remaining (locks=${remaining.advisoryLocks.length}, functions=${remaining.functions.length}, triggers=${remaining.triggers.length}).`
  );
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: concurrencyUserIds } }
  });
  for (const ownedContext of contexts.reverse()) {
    await cleanupAuditContext(ownedContext);
  }
  await prisma.$disconnect();
});

describe("verified inbound EMAIL drafts", () => {
  it("removes a gate function when trigger installation fails", async () => {
    const gateNamespace = 219_705;
    const markerNamespace = 219_706;
    const gateKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const markerKey = Math.floor(Math.random() * 1_000_000_000) + 1;

    try {
      await expect(
        installMailboxLifecycleGate(
          randomUUID(),
          "INVALID_FOR_TEST" as GateEvent,
          gateNamespace,
          gateKey,
          markerNamespace,
          markerKey
        )
      ).rejects.toThrow();

      const leakedFunctions = await prisma.$queryRaw<Array<{ name: string }>>`
        SELECT proname AS "name"
        FROM pg_proc
        WHERE proname LIKE 'gate_inbound_mailbox_%'
      `;
      expect(leakedFunctions).toEqual([]);
    } finally {
      const leakedFunctions = await prisma.$queryRaw<Array<{ name: string }>>`
        SELECT proname AS "name"
        FROM pg_proc
        WHERE proname LIKE 'gate_inbound_mailbox_%'
      `;
      for (const { name } of leakedFunctions) {
        const quotedName = name.replaceAll('"', '""');
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${quotedName}"()`
        );
      }
    }
  });

  it("rejects held and settles completion when advisory acquisition times out", async () => {
    type GateHandle = {
      held: Promise<void>;
      release: () => void;
      completion?: Promise<void>;
      transaction?: Promise<void>;
    };
    const startGate = holdAdvisoryGate as unknown as (
      namespace: number,
      key: number,
      options: { timeoutMs: number }
    ) => GateHandle;
    const namespace = 219_707;
    const key = Math.floor(Math.random() * 1_000_000_000) + 1;
    let blocker: GateHandle | null = null;
    let contender: GateHandle | null = null;

    try {
      blocker = startGate(namespace, key, { timeoutMs: 2_000 });
      await blocker.held;
      contender = startGate(namespace, key, { timeoutMs: 100 });
      const heldOutcome = await Promise.race([
        contender.held.then(
          () => "resolved",
          () => "rejected"
        ),
        new Promise<"pending">((resolve) =>
          setTimeout(() => resolve("pending"), 1_000)
        )
      ]);

      expect(heldOutcome).toBe("rejected");
      expect(contender.completion).toBeDefined();
      await expect(contender.completion).rejects.toThrow();
    } finally {
      contender?.release();
      blocker?.release();
      await (contender?.completion ?? contender?.transaction)?.catch(
        () => undefined
      );
      await (blocker?.completion ?? blocker?.transaction)?.catch(
        () => undefined
      );
    }
  }, 5_000);

  it.each([
    ["rotate", "UPDATE", rotateInboundMailbox],
    ["disable", "UPDATE", disableInboundMailbox],
    ["disconnect", "DELETE", disconnectInboundMailbox]
  ] as const)(
    "serializes a waiting builder after lifecycle-first %s",
    async (label, event, lifecycleAction) => {
      const fixture = await createConcurrencyFixture(label);
      const gateNamespace = 219_701;
      const markerNamespace = 219_702;
      const gateKey = Math.floor(Math.random() * 1_000_000_000) + 1;
      const markerKey = Math.floor(Math.random() * 1_000_000_000) + 1;
      let uninstallGate: GateCleanup = async () => undefined;
      let heldGate: ReturnType<typeof holdAdvisoryGate> | null = null;
      let lifecyclePromise: ReturnType<typeof lifecycleAction> | null = null;
      let builderPromise: Promise<
        Awaited<ReturnType<typeof createEmailDraftFromCandidate>>
      > | null = null;

      try {
        uninstallGate = await installMailboxLifecycleGate(
          fixture.mailbox.id,
          event,
          gateNamespace,
          gateKey,
          markerNamespace,
          markerKey
        );
        heldGate = holdAdvisoryGate(gateNamespace, gateKey);
        await heldGate.held;
        lifecyclePromise = lifecycleAction();
        await waitForAdvisoryLock(markerNamespace, markerKey);
        builderPromise = prisma.$transaction(
          (db) => createEmailDraftFromCandidate(db, fixture.input),
          { timeout: 20_000 }
        );
        await waitForMailboxLockWaiter();

        heldGate.release();
        await expect(lifecyclePromise).resolves.toMatchObject({ ok: true });
        await expect(builderPromise).rejects.toThrow(
          "Inbound email receipt is not available."
        );
        await expect(
          prisma.transactionDraft.count({
            where: {
              userId: fixture.userId,
              origin: "EMAIL"
            }
          })
        ).resolves.toBe(0);
      } finally {
        heldGate?.release();
        await lifecyclePromise?.catch(() => undefined);
        await builderPromise?.catch(() => undefined);
        await heldGate?.completion.catch(() => undefined);
        await uninstallGate();
      }
    },
    30_000
  );

  it("lets builder-first disconnect wait and remove the committed draft without an orphan", async () => {
    const fixture = await createConcurrencyFixture("builder-first-disconnect");
    const gateNamespace = 219_703;
    const markerNamespace = 219_704;
    const gateKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const markerKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    let uninstallGate: GateCleanup = async () => undefined;
    let heldGate: ReturnType<typeof holdAdvisoryGate> | null = null;
    let builderPromise: Promise<
      Awaited<ReturnType<typeof createEmailDraftFromCandidate>>
    > | null = null;
    let disconnectPromise: ReturnType<typeof disconnectInboundMailbox> | null = null;

    try {
      uninstallGate = await installDraftInsertGate(
        fixture.receipt.id,
        gateNamespace,
        gateKey,
        markerNamespace,
        markerKey
      );
      heldGate = holdAdvisoryGate(gateNamespace, gateKey);
      await heldGate.held;
      builderPromise = prisma.$transaction(
        (db) => createEmailDraftFromCandidate(db, fixture.input),
        { timeout: 20_000 }
      );
      await waitForAdvisoryLock(markerNamespace, markerKey);
      disconnectPromise = disconnectInboundMailbox();
      await waitForMailboxLockWaiter();

      heldGate.release();
      const created = await builderPromise;
      await expect(disconnectPromise).resolves.toMatchObject({
        ok: true,
        disconnected: true
      });
      await expect(
        prisma.transactionDraft.count({ where: { id: created.draftId } })
      ).resolves.toBe(0);
      await expect(
        prisma.inboundMailbox.count({ where: { id: fixture.mailbox.id } })
      ).resolves.toBe(0);
      await expect(
        prisma.inboundEmailReceipt.count({ where: { id: fixture.receipt.id } })
      ).resolves.toBe(0);
    } finally {
      heldGate?.release();
      await builderPromise?.catch(() => undefined);
      await disconnectPromise?.catch(() => undefined);
      await heldGate?.completion.catch(() => undefined);
      await uninstallGate();
    }
  }, 30_000);

  it("is owned, replay-safe, financially inert until explicit import, and redacted afterward", async () => {
    authState.userId = context.userA.id;
    const now = new Date("2026-08-10T12:00:00.000Z");
    const suffix = randomUUID();
    const [bank, card] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: `Synthetic bank ${suffix}`,
          type: MoneySourceType.BANK_ACCOUNT,
          openingBalance: "50.00"
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: `Synthetic card ${suffix}`,
          type: MoneySourceType.CREDIT_CARD,
          creditLimit: "500.00",
          initialOutstandingDebt: "20.00",
          initialCardCredit: "3.00"
        }
      })
    ]);
    await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.INCOME,
          amount: "100.00",
          title: `Synthetic baseline income ${suffix}`,
          transactionDate: new Date("2026-08-01T00:00:00.000Z"),
          toMoneySourceId: bank.id
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.EXPENSE,
          amount: "5.00",
          title: `Synthetic baseline card expense ${suffix}`,
          transactionDate: new Date("2026-08-02T00:00:00.000Z"),
          fromMoneySourceId: card.id
        }
      })
    ]);
    const before = await financialSnapshot(context.userA.id, bank, card);
    const [mailboxA, mailboxB] = await prisma.$transaction([
      prisma.inboundMailbox.create({
        data: {
          userId: context.userA.id,
          aliasLocalPart: aliasLocalPart()
        }
      }),
      prisma.inboundMailbox.create({
        data: {
          userId: context.userB.id,
          aliasLocalPart: aliasLocalPart()
        }
      })
    ]);
    const receipt = await createReceipt(context.userA.id, mailboxA.id, now);
    const input = {
      userId: context.userA.id,
      mailboxId: mailboxA.id,
      aliasLocalPart: mailboxA.aliasLocalPart,
      receiptId: receipt.id,
      candidate: candidate(`Synthetic merchant ${suffix}`),
      now
    };

    await expect(
      prisma.$transaction((db) =>
        createEmailDraftFromCandidate(db, {
          ...input,
          userId: context.userB.id
        })
      )
    ).rejects.toThrow("Inbound email receipt is not available.");
    await expect(
      prisma.$transaction((db) =>
        createEmailDraftFromCandidate(db, {
          ...input,
          mailboxId: mailboxB.id,
          aliasLocalPart: mailboxB.aliasLocalPart
        })
      )
    ).rejects.toThrow("Inbound email receipt is not available.");
    await expect(
      prisma.$transaction((db) =>
        createEmailDraftFromCandidate(db, {
          ...input,
          aliasLocalPart: `${mailboxA.aliasLocalPart}_stale`
        })
      )
    ).rejects.toThrow("Inbound email receipt is not available.");
    await prisma.inboundMailbox.update({
      where: { id: mailboxA.id },
      data: { status: "DISABLED" }
    });
    await expect(
      prisma.$transaction((db) => createEmailDraftFromCandidate(db, input))
    ).rejects.toThrow("Inbound email receipt is not available.");
    await prisma.inboundMailbox.update({
      where: { id: mailboxA.id },
      data: { status: "ACTIVE" }
    });

    const [first, replay] = await Promise.all([
      prisma.$transaction((db) => createEmailDraftFromCandidate(db, input)),
      prisma.$transaction((db) => createEmailDraftFromCandidate(db, input))
    ]);
    expect(first.draftId).toBe(replay.draftId);
    expect(first.captureKey).toBe(replay.captureKey);
    expect([first.created, replay.created].sort()).toEqual([false, true]);
    await expect(
      prisma.transactionDraft.count({
        where: {
          userId: context.userA.id,
          inboundEmailReceiptId: receipt.id
        }
      })
    ).resolves.toBe(1);
    await expect(financialSnapshot(context.userA.id, bank, card)).resolves.toEqual(
      before
    );

    const edited = await updateTransactionDraft(first.draftId, {
      fromMoneySourceId: bank.id
    });
    expect(edited).toMatchObject({
      ok: true,
      draft: { origin: "EMAIL", status: "READY" }
    });
    await expect(financialSnapshot(context.userA.id, bank, card)).resolves.toEqual(
      before
    );

    const idempotencyKey = randomUUID();
    const imported = await importTransactionDrafts({
      ids: [first.draftId],
      idempotencyKey
    });
    expect(imported).toMatchObject({ ok: true, importedCount: 1 });
    if (!imported.ok) throw new Error(imported.error);
    await expect(
      importTransactionDrafts({ ids: [first.draftId], idempotencyKey })
    ).resolves.toEqual(imported);
    await expect(
      prisma.transaction.count({
        where: { id: { in: imported.transactionIds }, userId: context.userA.id }
      })
    ).resolves.toBe(1);

    const batch = await prisma.transactionImportBatch.findUniqueOrThrow({
      where: {
        userId_idempotencyKey: {
          userId: context.userA.id,
          idempotencyKey
        }
      },
      select: { id: true }
    });
    await expect(
      prisma.activityLog.findMany({
        where: {
          userId: context.userA.id,
          entityId: { in: [imported.transactionIds[0], batch.id] }
        },
        orderBy: { action: "asc" },
        select: { action: true }
      })
    ).resolves.toEqual([
      { action: "TRANSACTION_BATCH_IMPORTED" },
      { action: "TRANSACTION_CREATED" }
    ]);

    const redacted = await prisma.transactionDraft.findUniqueOrThrow({
      where: { id: first.draftId },
      select: {
        id: true,
        userId: true,
        captureKey: true,
        position: true,
        origin: true,
        inboundEmailReceiptId: true,
        status: true,
        importBatchId: true,
        importedTransactionId: true,
        confidence: true,
        type: true,
        amountText: true,
        currency: true,
        title: true,
        description: true,
        transactionDateText: true,
        categoryId: true,
        qualityRating: true,
        fromMoneySourceId: true,
        toMoneySourceId: true,
        adjustedMoneySourceId: true,
        adjustmentDirection: true,
        adjustmentTarget: true,
        projectId: true,
        relatedTransactionId: true,
        countTowardFeeWaiver: true,
        countTowardFeeWaiverTouched: true,
        qualityRatingTouched: true,
        recurringPaymentId: true,
        isInstallmentRelated: true,
        duplicateFingerprint: true,
        duplicateConfirmed: true,
        duplicateAcknowledgementRequired: true,
        invalidMappedFields: true,
        validationIssues: true,
        rawRow: true
      }
    });
    expect(redacted).toEqual({
      id: first.draftId,
      userId: context.userA.id,
      captureKey: first.captureKey,
      position: 0,
      origin: "EMAIL",
      inboundEmailReceiptId: receipt.id,
      status: TransactionDraftStatus.IMPORTED,
      importBatchId: batch.id,
      importedTransactionId: imported.transactionIds[0],
      confidence: null,
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
      countTowardFeeWaiverTouched: false,
      qualityRatingTouched: false,
      recurringPaymentId: null,
      isInstallmentRelated: false,
      duplicateFingerprint: null,
      duplicateConfirmed: false,
      duplicateAcknowledgementRequired: false,
      invalidMappedFields: [],
      validationIssues: [],
      rawRow: null
    });
  }, 30_000);

  it("clears a dismissed EMAIL draft while keeping receipt idempotency provenance", async () => {
    authState.userId = context.userA.id;
    const now = new Date("2026-08-11T12:00:00.000Z");
    const mailbox = await prisma.inboundMailbox.findUniqueOrThrow({
      where: { userId: context.userA.id }
    });
    const receipt = await createReceipt(context.userA.id, mailbox.id, now);
    const created = await prisma.$transaction((db) =>
      createEmailDraftFromCandidate(db, {
        userId: context.userA.id,
        mailboxId: mailbox.id,
        aliasLocalPart: mailbox.aliasLocalPart,
        receiptId: receipt.id,
        candidate: candidate(`Synthetic dismissed merchant ${randomUUID()}`),
        now
      })
    );

    await expect(dismissTransactionDrafts([created.draftId])).resolves.toEqual({
      ok: true,
      dismissedCount: 1,
      dismissedIds: [created.draftId]
    });
    await expect(
      prisma.transactionDraft.findUniqueOrThrow({
        where: { id: created.draftId },
        select: {
          origin: true,
          inboundEmailReceiptId: true,
          status: true,
          confidence: true,
          amountText: true,
          title: true,
          description: true,
          transactionDateText: true,
          rawRow: true,
          validationIssues: true
        }
      })
    ).resolves.toEqual({
      origin: "EMAIL",
      inboundEmailReceiptId: receipt.id,
      status: "DISMISSED",
      confidence: null,
      amountText: null,
      title: null,
      description: null,
      transactionDateText: null,
      rawRow: null,
      validationIssues: []
    });
  });
});
