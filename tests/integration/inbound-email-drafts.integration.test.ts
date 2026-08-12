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
  createInboundMailbox,
  disableInboundMailbox,
  disconnectInboundMailbox,
  rotateInboundMailbox
} from "@/lib/actions/inbound-email";
import { listGoals } from "@/lib/actions/goals";
import { listProjects } from "@/lib/actions/projects";
import { loadIncomeVsExpenseOverTime } from "@/lib/actions/reports";
import { calculateAccountProjection } from "@/lib/calc/dashboard";
import { calculateCreditCardState } from "@/lib/calc/credit-card";
import { calculateGoalProgress } from "@/lib/calc/goals";
import { calculateProjectSummary } from "@/lib/calc/projects";
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

type GateEvent = "INSERT" | "UPDATE" | "DELETE";
type GateCleanup = () => Promise<void>;

const TEST_GATE_NAMESPACE_MIN = 219_701;
const TEST_GATE_NAMESPACE_MAX = 219_707;
const GATE_SUFFIX_PATTERN = /^[0-9a-f]{32}$/;
const INBOUND_GATE_FUNCTION_PATTERN =
  /^gate_inbound_mailbox_[0-9a-f]{32}$/;
const INBOUND_GATE_TRIGGER_PATTERN =
  /^gate_inbound_mailbox_trigger_[0-9a-f]{32}$/;
const DRAFT_GATE_FUNCTION_PATTERN =
  /^gate_email_draft_insert_[0-9a-f]{32}$/;
const DRAFT_GATE_TRIGGER_PATTERN =
  /^gate_email_draft_trigger_[0-9a-f]{32}$/;
const INBOUND_GATE_FUNCTION_SQL_PATTERN =
  "^gate_inbound_mailbox_[0-9a-f]{32}$";
const INBOUND_GATE_TRIGGER_SQL_PATTERN =
  "^gate_inbound_mailbox_trigger_[0-9a-f]{32}$";
const DRAFT_GATE_FUNCTION_SQL_PATTERN =
  "^gate_email_draft_insert_[0-9a-f]{32}$";
const DRAFT_GATE_TRIGGER_SQL_PATTERN =
  "^gate_email_draft_trigger_[0-9a-f]{32}$";

function sqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function sqlIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function currentSchemaName() {
  const [schema] = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT current_schema() AS "name"
  `;
  if (!schema) throw new Error("Synthetic test schema is unavailable.");
  return schema.name;
}

function generatedGateName(prefix: string, suffix: string) {
  if (!GATE_SUFFIX_PATTERN.test(suffix)) {
    throw new Error("Synthetic gate suffix is invalid.");
  }
  return `${prefix}${suffix}`;
}

function isGeneratedGateFunctionName(name: string) {
  return (
    INBOUND_GATE_FUNCTION_PATTERN.test(name) ||
    DRAFT_GATE_FUNCTION_PATTERN.test(name)
  );
}

function expectedGateTableForTrigger(name: string) {
  if (INBOUND_GATE_TRIGGER_PATTERN.test(name)) return "InboundMailbox";
  if (DRAFT_GATE_TRIGGER_PATTERN.test(name)) return "TransactionDraft";
  return null;
}

function databaseGateCleanup(
  schemaName: string,
  tableName: "InboundMailbox" | "TransactionDraft",
  triggerName: string,
  functionName: string
): GateCleanup {
  return async () => {
    let firstError: unknown;
    const cleanupSchemaName = await currentSchemaName();

    if (
      schemaName !== cleanupSchemaName ||
      !isGeneratedGateFunctionName(functionName) ||
      expectedGateTableForTrigger(triggerName) !== tableName
    ) {
      throw new Error("Synthetic gate cleanup target is invalid.");
    }

    try {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${sqlIdentifier(triggerName)} ON ${sqlIdentifier(schemaName)}.${sqlIdentifier(tableName)}`
      );
    } catch (error) {
      firstError = error;
    }
    try {
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${sqlIdentifier(schemaName)}.${sqlIdentifier(functionName)}()`
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
  markerKey: number,
  suffix = randomUUID().replaceAll("-", "")
) {
  const schemaName = await currentSchemaName();
  const functionName = generatedGateName("gate_inbound_mailbox_", suffix);
  const triggerName = generatedGateName(
    "gate_inbound_mailbox_trigger_",
    suffix
  );
  const rowId = sqlLiteral(mailboxId);
  const rowReference =
    event === "INSERT" ? 'NEW."userId"' : 'OLD."id"';
  const cleanup = databaseGateCleanup(
    schemaName,
    "InboundMailbox",
    triggerName,
    functionName
  );
  let functionCreated = false;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${sqlIdentifier(schemaName)}.${sqlIdentifier(functionName)}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF ${rowReference} = '${rowId}' THEN
          PERFORM pg_advisory_xact_lock(${markerNamespace}, ${markerKey});
          PERFORM pg_advisory_xact_lock(${gateNamespace}, ${gateKey});
        END IF;
        RETURN ${event === "DELETE" ? "OLD" : "NEW"};
      END;
      $$;
    `);
    functionCreated = true;
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${sqlIdentifier(triggerName)}
      BEFORE ${event} ON ${sqlIdentifier(schemaName)}."InboundMailbox"
      FOR EACH ROW EXECUTE FUNCTION ${sqlIdentifier(schemaName)}.${sqlIdentifier(functionName)}();
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
  markerKey: number,
  suffix = randomUUID().replaceAll("-", "")
) {
  const schemaName = await currentSchemaName();
  const functionName = generatedGateName("gate_email_draft_insert_", suffix);
  const triggerName = generatedGateName("gate_email_draft_trigger_", suffix);
  const ownedReceiptId = sqlLiteral(receiptId);
  const cleanup = databaseGateCleanup(
    schemaName,
    "TransactionDraft",
    triggerName,
    functionName
  );
  let functionCreated = false;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${sqlIdentifier(schemaName)}.${sqlIdentifier(functionName)}() RETURNS trigger
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
      CREATE TRIGGER ${sqlIdentifier(triggerName)}
      BEFORE INSERT ON ${sqlIdentifier(schemaName)}."TransactionDraft"
      FOR EACH ROW EXECUTE FUNCTION ${sqlIdentifier(schemaName)}.${sqlIdentifier(functionName)}();
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

async function waitForAdvisoryLockWaiter(namespace: number, key: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = ${namespace}::oid
          AND objid = ${key}::oid
          AND objsubid = 2
          AND NOT granted
      ) AS "waiting"
    `;
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the deterministic advisory waiter.");
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
  card: Awaited<ReturnType<typeof prisma.moneySource.create>>,
  goalId: string,
  projectId: string
) {
  const [transactions, report, goals, projects, financialActivities] =
    await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ transactionDate: "asc" }, { id: "asc" }]
      }),
      loadIncomeVsExpenseOverTime({
        startDate: "2026-08-01",
        endDate: "2026-08-31"
      }),
      listGoals(),
      listProjects(),
      prisma.activityLog.findMany({
        where: {
          userId,
          entityType: {
            in: [
              "Transaction",
              "SavingGoal",
              "GoalContribution",
              "FinancialProject"
            ]
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { action: true, entityType: true, entityId: true }
      })
    ]);
  const cardState = calculateCreditCardState(card, transactions);
  const goal = goals.find((candidateGoal) => candidateGoal.id === goalId);
  const project = projects.find(
    (candidateProject) => candidateProject.id === projectId
  );
  if (!goal || !project) {
    throw new Error("Synthetic goal or project projection is unavailable.");
  }
  const goalProgress = calculateGoalProgress(
    goal.goalContributions,
    goal.targetAmount
  );
  const projectSummary = calculateProjectSummary(
    transactions.filter((transaction) => transaction.projectId === project.id)
  );

  return {
    transactionCount: transactions.length,
    bankBalance: calculateAccountProjection(bank, transactions).trackedAmount.toFixed(2),
    cardDebt: cardState.outstandingDebt.toFixed(2),
    cardCredit: cardState.cardCredit.toFixed(2),
    goal: {
      netContributed: goalProgress.netContributed.toFixed(2),
      progressPercent: goalProgress.progressPercent.toFixed(2),
      remaining: goalProgress.remaining.toFixed(2)
    },
    project: {
      totalIncome: projectSummary.totalIncome.toFixed(2),
      totalExpense: projectSummary.totalExpense.toFixed(2),
      profit: projectSummary.profit.toFixed(2),
      roi: projectSummary.roi?.toFixed(2) ?? null
    },
    financialActivities,
    report: report.map(({ period, income, expense }) => ({
      period,
      income: income.toFixed(2),
      expense: expense.toFixed(2)
    }))
  };
}

type TestGateResources = {
  advisoryLocks: Array<{ pid: number }>;
  functions: Array<{ name: string; schemaName: string }>;
  triggers: Array<{ name: string; schemaName: string; tableName: string }>;
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
    prisma.$queryRaw<Array<{ name: string; schemaName: string }>>`
      SELECT
        procedure.proname AS "name",
        namespace.nspname AS "schemaName"
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = current_schema()
        AND (
          procedure.proname ~ ${INBOUND_GATE_FUNCTION_SQL_PATTERN}
          OR procedure.proname ~ ${DRAFT_GATE_FUNCTION_SQL_PATTERN}
        )
    `,
    prisma.$queryRaw<
      Array<{ name: string; schemaName: string; tableName: string }>
    >`
      SELECT
        trigger.tgname AS "name",
        namespace.nspname AS "schemaName",
        relation.relname AS "tableName"
      FROM pg_trigger AS trigger
      JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND (
          (
            relation.relname = 'InboundMailbox'
            AND trigger.tgname ~ ${INBOUND_GATE_TRIGGER_SQL_PATTERN}
          )
          OR (
            relation.relname = 'TransactionDraft'
            AND trigger.tgname ~ ${DRAFT_GATE_TRIGGER_SQL_PATTERN}
          )
        )
    `
  ]);

  return { advisoryLocks, functions, triggers };
}

async function recoverTestGateResources(resources: TestGateResources) {
  const cleanupErrors: unknown[] = [];
  const schemaName = await currentSchemaName();

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
    if (
      trigger.schemaName !== schemaName ||
      expectedGateTableForTrigger(trigger.name) !== trigger.tableName
    ) {
      cleanupErrors.push(new Error("Synthetic trigger cleanup target rejected."));
      continue;
    }
    try {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${sqlIdentifier(trigger.name)} ON ${sqlIdentifier(trigger.schemaName)}.${sqlIdentifier(trigger.tableName)}`
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const gateFunction of resources.functions) {
    if (
      gateFunction.schemaName !== schemaName ||
      !isGeneratedGateFunctionName(gateFunction.name)
    ) {
      cleanupErrors.push(
        new Error("Synthetic function cleanup target rejected.")
      );
      continue;
    }
    try {
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${sqlIdentifier(gateFunction.schemaName)}.${sqlIdentifier(gateFunction.name)}()`
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
  it("converges concurrent authenticated mailbox creation on one safe setup", async () => {
    const user = await prisma.user.create({
      data: {
        email: `inbound-action-concurrency-${randomUUID()}@audit.invalid`,
        name: "Synthetic inbound action concurrency user",
        passwordHash: "synthetic-non-authenticated-test-hash"
      },
      select: { id: true }
    });
    concurrencyUserIds.push(user.id);
    authState.userId = user.id;
    const gateNamespace = 219_705;
    const markerNamespace = 219_706;
    const gateKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const markerKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    let uninstallGate: GateCleanup = async () => undefined;
    let heldGate: ReturnType<typeof holdAdvisoryGate> | null = null;
    let first: ReturnType<typeof createInboundMailbox> | null = null;
    let second: ReturnType<typeof createInboundMailbox> | null = null;
    let results!: Awaited<ReturnType<typeof createInboundMailbox>>[];

    try {
      uninstallGate = await installMailboxLifecycleGate(
        user.id,
        "INSERT",
        gateNamespace,
        gateKey,
        markerNamespace,
        markerKey
      );
      heldGate = holdAdvisoryGate(gateNamespace, gateKey);
      await heldGate.held;
      first = createInboundMailbox();
      await waitForAdvisoryLock(markerNamespace, markerKey);
      second = createInboundMailbox();
      await waitForAdvisoryLockWaiter(markerNamespace, markerKey);

      heldGate.release();
      results = await Promise.all([first, second]);
    } finally {
      heldGate?.release();
      await first?.catch(() => undefined);
      await second?.catch(() => undefined);
      await heldGate?.completion.catch(() => undefined);
      await uninstallGate();
    }

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      ok: true,
      setup: {
        configured: true,
        mailbox: {
          address: expect.stringMatching(/^m_[0-9a-f]{40}@inbound\.audit\.invalid$/),
          status: "ACTIVE",
          lastDisposition: null,
          lastReceivedAt: null,
          reviewCaptureKey: null
        }
      }
    });
    expect(JSON.stringify(results)).not.toContain(user.id);
    await expect(
      prisma.inboundMailbox.count({ where: { userId: user.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.activityLog.findMany({
        where: {
          userId: user.id,
          action: "INBOUND_EMAIL_CONNECTED"
        },
        select: {
          action: true,
          entityType: true,
          entityId: true,
          metadata: true
        }
      })
    ).resolves.toEqual([
      {
        action: "INBOUND_EMAIL_CONNECTED",
        entityType: "InboundEmail",
        entityId: null,
        metadata: null
      }
    ]);
  }, 30_000);

  it("recovers exact generated gate objects without dropping wildcard decoys", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const genuineFunction = `gate_inbound_mailbox_${suffix}`;
    const genuineTrigger = `gate_inbound_mailbox_trigger_${suffix}`;
    const decoyFunction = "gateXinboundYmailboxZdecoy";
    const decoyTrigger = "gateXinboundYmailboxZtriggerQdecoy";
    const [schema] = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_schema() AS "name"
    `;
    if (!schema) throw new Error("Synthetic test schema is unavailable.");
    const qualifiedFunction = (name: string) =>
      `${sqlIdentifier(schema.name)}.${sqlIdentifier(name)}`;

    try {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION ${qualifiedFunction(decoyFunction)}() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER ${sqlIdentifier(decoyTrigger)}
        BEFORE UPDATE ON ${sqlIdentifier(schema.name)}."User"
        FOR EACH ROW EXECUTE FUNCTION ${qualifiedFunction(decoyFunction)}()
      `);
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION ${qualifiedFunction(genuineFunction)}() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER ${sqlIdentifier(genuineTrigger)}
        BEFORE UPDATE ON ${sqlIdentifier(schema.name)}."InboundMailbox"
        FOR EACH ROW EXECUTE FUNCTION ${qualifiedFunction(genuineFunction)}()
      `);

      const resources = await inspectTestGateResources();
      await expect(recoverTestGateResources(resources)).resolves.toBe(0);

      const [state] = await prisma.$queryRaw<
        Array<{
          decoyFunction: boolean;
          decoyTrigger: boolean;
          genuineFunction: boolean;
          genuineTrigger: boolean;
        }>
      >`
        SELECT
          EXISTS (
            SELECT 1
            FROM pg_proc AS procedure
            JOIN pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = ${schema.name}
              AND procedure.proname = ${decoyFunction}
          ) AS "decoyFunction",
          EXISTS (
            SELECT 1
            FROM pg_trigger AS trigger
            JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
            JOIN pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = ${schema.name}
              AND relation.relname = 'User'
              AND trigger.tgname = ${decoyTrigger}
          ) AS "decoyTrigger",
          EXISTS (
            SELECT 1
            FROM pg_proc AS procedure
            JOIN pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = ${schema.name}
              AND procedure.proname = ${genuineFunction}
          ) AS "genuineFunction",
          EXISTS (
            SELECT 1
            FROM pg_trigger AS trigger
            JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
            JOIN pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = ${schema.name}
              AND relation.relname = 'InboundMailbox'
              AND trigger.tgname = ${genuineTrigger}
          ) AS "genuineTrigger"
      `;
      expect(state).toEqual({
        decoyFunction: true,
        decoyTrigger: true,
        genuineFunction: false,
        genuineTrigger: false
      });
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${sqlIdentifier(decoyTrigger)} ON ${sqlIdentifier(schema.name)}."User"`
      );
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${sqlIdentifier(genuineTrigger)} ON ${sqlIdentifier(schema.name)}."InboundMailbox"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${qualifiedFunction(decoyFunction)}()`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${qualifiedFunction(genuineFunction)}()`
      );
    }
  });

  it("removes a gate function when trigger installation fails", async () => {
    const gateNamespace = 219_705;
    const markerNamespace = 219_706;
    const gateKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const markerKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `gate_inbound_mailbox_${suffix}`;
    const schemaName = await currentSchemaName();

    try {
      await expect(
        installMailboxLifecycleGate(
          randomUUID(),
          "INVALID_FOR_TEST" as GateEvent,
          gateNamespace,
          gateKey,
          markerNamespace,
          markerKey,
          suffix
        )
      ).rejects.toThrow();

      const leakedFunctions = await prisma.$queryRaw<
        Array<{ name: string; schemaName: string }>
      >`
        SELECT
          procedure.proname AS "name",
          namespace.nspname AS "schemaName"
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = ${schemaName}
          AND procedure.proname = ${functionName}
      `;
      expect(leakedFunctions).toEqual([]);
    } finally {
      const leakedFunctions = await prisma.$queryRaw<
        Array<{ name: string; schemaName: string }>
      >`
        SELECT
          procedure.proname AS "name",
          namespace.nspname AS "schemaName"
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = ${schemaName}
          AND procedure.proname = ${functionName}
      `;
      for (const leaked of leakedFunctions) {
        if (
          leaked.schemaName !== schemaName ||
          leaked.name !== functionName ||
          !INBOUND_GATE_FUNCTION_PATTERN.test(leaked.name)
        ) {
          throw new Error("Synthetic failure cleanup target rejected.");
        }
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS ${sqlIdentifier(leaked.schemaName)}.${sqlIdentifier(leaked.name)}()`
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
          setTimeout(() => resolve("pending"), 3_000)
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
  }, 8_000);

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
    const [bank, card, goal, project] = await prisma.$transaction([
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
      }),
      prisma.savingGoal.create({
        data: {
          userId: context.userA.id,
          name: `Synthetic goal ${suffix}`,
          targetAmount: "1000.00"
        }
      }),
      prisma.financialProject.create({
        data: {
          userId: context.userA.id,
          name: `Synthetic project ${suffix}`
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
          toMoneySourceId: bank.id,
          projectId: project.id
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.EXPENSE,
          amount: "5.00",
          title: `Synthetic baseline card expense ${suffix}`,
          transactionDate: new Date("2026-08-02T00:00:00.000Z"),
          fromMoneySourceId: card.id,
          projectId: project.id
        }
      }),
      prisma.goalContribution.create({
        data: {
          userId: context.userA.id,
          savingGoalId: goal.id,
          amount: "250.00",
          type: "CONTRIBUTION",
          contributionDate: new Date("2026-08-03T00:00:00.000Z")
        }
      }),
      prisma.goalContribution.create({
        data: {
          userId: context.userA.id,
          savingGoalId: goal.id,
          amount: "50.00",
          type: "WITHDRAWAL",
          contributionDate: new Date("2026-08-04T00:00:00.000Z")
        }
      })
    ]);
    const before = await financialSnapshot(
      context.userA.id,
      bank,
      card,
      goal.id,
      project.id
    );
    expect(before).toMatchObject({
      goal: {
        netContributed: "200.00",
        progressPercent: "20.00",
        remaining: "800.00"
      },
      project: {
        totalIncome: "100.00",
        totalExpense: "5.00",
        profit: "95.00",
        roi: "1900.00"
      },
      financialActivities: []
    });
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
      prisma.$transaction(
        (db) =>
          createEmailDraftFromCandidate(db, {
            ...input,
            userId: context.userB.id
          }),
        { timeout: 20_000 }
      )
    ).rejects.toThrow("Inbound email receipt is not available.");
    await expect(
      prisma.$transaction(
        (db) =>
          createEmailDraftFromCandidate(db, {
            ...input,
            mailboxId: mailboxB.id,
            aliasLocalPart: mailboxB.aliasLocalPart
          }),
        { timeout: 20_000 }
      )
    ).rejects.toThrow("Inbound email receipt is not available.");
    await expect(
      prisma.$transaction(
        (db) =>
          createEmailDraftFromCandidate(db, {
            ...input,
            aliasLocalPart: `${mailboxA.aliasLocalPart}_stale`
          }),
        { timeout: 20_000 }
      )
    ).rejects.toThrow("Inbound email receipt is not available.");
    await prisma.inboundMailbox.update({
      where: { id: mailboxA.id },
      data: { status: "DISABLED" }
    });
    await expect(
      prisma.$transaction(
        (db) => createEmailDraftFromCandidate(db, input),
        { timeout: 20_000 }
      )
    ).rejects.toThrow("Inbound email receipt is not available.");
    await prisma.inboundMailbox.update({
      where: { id: mailboxA.id },
      data: { status: "ACTIVE" }
    });

    const [first, replay] = await Promise.all([
      prisma.$transaction(
        (db) => createEmailDraftFromCandidate(db, input),
        { timeout: 20_000 }
      ),
      prisma.$transaction(
        (db) => createEmailDraftFromCandidate(db, input),
        { timeout: 20_000 }
      )
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
    await expect(
      financialSnapshot(
        context.userA.id,
        bank,
        card,
        goal.id,
        project.id
      )
    ).resolves.toEqual(before);
    await expect(
      prisma.transactionDraft.findUniqueOrThrow({
        where: { id: first.draftId },
        select: {
          origin: true,
          status: true,
          confidence: true,
          type: true,
          amountText: true,
          currency: true,
          title: true,
          description: true,
          transactionDateText: true,
          fromMoneySourceId: true,
          projectId: true,
          rawRow: true
        }
      })
    ).resolves.toEqual({
      origin: "EMAIL",
      status: "NEEDS_REVIEW",
      confidence: 100,
      type: "EXPENSE",
      amountText: "125000",
      currency: "VND",
      title: input.candidate.title,
      description: "Synthetic inbound-email test data.",
      transactionDateText: "2026-08-10",
      fromMoneySourceId: null,
      projectId: null,
      rawRow: null
    });

    const edited = await updateTransactionDraft(first.draftId, {
      fromMoneySourceId: bank.id
    });
    expect(edited).toMatchObject({
      ok: true,
      draft: { origin: "EMAIL", status: "READY" }
    });
    await expect(
      financialSnapshot(
        context.userA.id,
        bank,
        card,
        goal.id,
        project.id
      )
    ).resolves.toEqual(before);

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
  }, 60_000);

  it("clears a dismissed EMAIL draft while keeping receipt idempotency provenance", async () => {
    authState.userId = context.userA.id;
    const now = new Date("2026-08-11T12:00:00.000Z");
    const mailbox = await prisma.inboundMailbox.findUniqueOrThrow({
      where: { userId: context.userA.id }
    });
    const receipt = await createReceipt(context.userA.id, mailbox.id, now);
    const created = await prisma.$transaction(
      (db) =>
        createEmailDraftFromCandidate(db, {
          userId: context.userA.id,
          mailboxId: mailbox.id,
          aliasLocalPart: mailbox.aliasLocalPart,
          receiptId: receipt.id,
          candidate: candidate(`Synthetic dismissed merchant ${randomUUID()}`),
          now
        }),
      { timeout: 20_000 }
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
