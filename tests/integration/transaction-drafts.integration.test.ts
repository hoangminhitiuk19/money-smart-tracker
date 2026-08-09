import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  CategoryType,
  MoneySourceType,
  QualityRating,
  TransactionDraftOrigin,
  TransactionDraftStatus,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as exportTransactions } from "@/app/api/export/transactions/route";
import {
  dismissTransactionDrafts,
  importTransactionDrafts,
  listTransactionDrafts,
  savePasteDrafts,
  saveQuickDraft,
  updateTransactionDraft
} from "@/lib/actions/transaction-drafts";
import {
  getDashboardData
} from "@/lib/actions/dashboard";
import {
  loadCreditCardDebtReport,
  loadExpenseByCategory,
  loadFeeWaiverReport,
  loadIncomeVsExpenseOverTime,
  loadProjectProfitLoss,
  loadSpendingBySource,
  loadSpendingQualityBreakdown
} from "@/lib/actions/reports";
import { calculateAccountProjection } from "@/lib/calc/dashboard";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredTransactionDrafts } from "@/lib/transaction-drafts/retention";
import type { TransactionDraftInput } from "@/lib/transaction-drafts/types";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import { parseCsv } from "@/tests/integration/helpers/csv";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "draft-audit@audit.invalid",
    name: "Draft audit user"
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
  checkExport: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 10,
    remaining: 9,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

type Fixtures = {
  context: AuditContext;
  bankAId: string;
  bankBId: string;
  categoryBId: string;
  projectBId: string;
  expenseBId: string;
  foreignNames: string[];
};

const contexts: AuditContext[] = [];
let fixtures: Fixtures;

function expenseDraft(
  captureKey: string,
  fromMoneySourceId: string,
  overrides: Partial<TransactionDraftInput> = {}
): TransactionDraftInput {
  return {
    captureKey,
    position: 0,
    origin: TransactionDraftOrigin.PASTE,
    type: TransactionType.EXPENSE,
    amountText: "90071992547409.99",
    currency: "VND",
    title: "Audit lunch",
    description: null,
    transactionDateText: "2026-08-04",
    categoryId: null,
    qualityRating: null,
    fromMoneySourceId,
    toMoneySourceId: null,
    adjustedMoneySourceId: null,
    adjustmentDirection: null,
    adjustmentTarget: null,
    projectId: null,
    relatedTransactionId: null,
    countTowardFeeWaiver: null,
    recurringPaymentId: null,
    isInstallmentRelated: false,
    duplicateConfirmed: false,
    rawRow: { Amount: "90071992547409.99" },
    ...overrides
  };
}

async function saveReadyExpenseDrafts(count: number) {
  const captureKey = randomUUID();
  const result = await savePasteDrafts({
    captureKey,
    rows: Array.from({ length: count }, (_, position) =>
      expenseDraft(captureKey, fixtures.bankAId, {
        position,
        amountText: `${position + 10}.25`,
        title: `Import expense ${captureKey} ${position}`,
        rawRow: { Amount: `${position + 10}.25` }
      })
    )
  });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.error);
  expect(result.drafts).toHaveLength(count);
  expect(result.drafts.every(({ status }) => status === "READY")).toBe(true);
  return result.drafts;
}

async function installDraftImportActivityFailure(userId: string) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `fail_draft_import_activity_${suffix}`;
  const triggerName = `fail_draft_import_activity_trigger_${suffix}`;

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."userId" = '${userId}' AND NEW."action" LIKE 'TRANSACTION_%' THEN
        RAISE EXCEPTION 'forced draft import activity failure';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "ActivityLog"
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);

  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "ActivityLog"`
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`
    );
  };
}

async function installImportLifecycleGate(
  draftId: string,
  gateNamespace: number,
  gateKey: number,
  markerNamespace: number,
  markerKey: number
) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `gate_draft_import_${suffix}`;
  const triggerName = `gate_draft_import_trigger_${suffix}`;

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD."id" = '${draftId}'
        AND OLD."status" = 'READY'
        AND NEW."status" = 'IMPORTING' THEN
        PERFORM pg_advisory_xact_lock(${markerNamespace}, ${markerKey});
        PERFORM pg_advisory_xact_lock(${gateNamespace}, ${gateKey});
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE UPDATE ON "TransactionDraft"
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);

  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "TransactionDraft"`
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`
    );
  };
}

async function installReassessmentWriteGate(
  editedDraftId: string,
  editedTitle: string,
  gateNamespace: number,
  gateKey: number,
  markerNamespace: number,
  markerKey: number
) {
  const suffix = randomUUID().replaceAll("-", "");
  const settingName = `mqt.reassess_${suffix}`;
  const armFunctionName = `arm_draft_reassessment_${suffix}`;
  const armTriggerName = `arm_draft_reassessment_trigger_${suffix}`;
  const gateFunctionName = `gate_draft_reassessment_${suffix}`;
  const gateTriggerName = `gate_draft_reassessment_trigger_${suffix}`;

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${armFunctionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD."id" = '${editedDraftId}'
        AND OLD."title" IS DISTINCT FROM NEW."title"
        AND NEW."title" = '${editedTitle}' THEN
        PERFORM set_config('${settingName}', 'armed', true);
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${gateFunctionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('${settingName}', true) = 'armed' THEN
        PERFORM set_config('${settingName}', 'released', true);
        PERFORM pg_advisory_xact_lock(${markerNamespace}, ${markerKey});
        PERFORM pg_advisory_xact_lock(${gateNamespace}, ${gateKey});
      END IF;
      RETURN NULL;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${gateTriggerName}"
    BEFORE UPDATE ON "TransactionDraft"
    FOR EACH STATEMENT EXECUTE FUNCTION "${gateFunctionName}"();
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${armTriggerName}"
    BEFORE UPDATE ON "TransactionDraft"
    FOR EACH ROW EXECUTE FUNCTION "${armFunctionName}"();
  `);

  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${gateTriggerName}" ON "TransactionDraft"`
    );
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${armTriggerName}" ON "TransactionDraft"`
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${gateFunctionName}"()`
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${armFunctionName}"()`
    );
  };
}

async function waitForAdvisoryLock(namespace: number, key: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ held: boolean }>>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = '${namespace}'::oid
          AND objid = '${key}'::oid
          AND objsubid = 2
          AND granted
      ) AS "held"
    `);
    if (row?.held) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the forced import lifecycle gate.");
}

beforeAll(async () => {
  const context = await createAuditContext(`transaction-drafts-${randomUUID()}`);
  contexts.push(context);
  const foreignNames = [
    `Foreign source ${randomUUID()}`,
    `Foreign category ${randomUUID()}`,
    `Foreign project ${randomUUID()}`,
    `Foreign original expense ${randomUUID()}`
  ];
  const [bankA, bankB, categoryB, projectB] = await prisma.$transaction([
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: `Owned draft bank ${randomUUID()}`,
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userB.id,
        name: foreignNames[0],
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.category.create({
      data: {
        userId: context.userB.id,
        name: foreignNames[1],
        type: CategoryType.EXPENSE
      }
    }),
    prisma.financialProject.create({
      data: { userId: context.userB.id, name: foreignNames[2] }
    })
  ]);
  const expenseB = await prisma.transaction.create({
    data: {
      userId: context.userB.id,
      type: TransactionType.EXPENSE,
      amount: "12.00",
      title: foreignNames[3],
      transactionDate: new Date("2026-08-01T00:00:00.000Z"),
      fromMoneySourceId: bankB.id
    }
  });
  fixtures = {
    context,
    bankAId: bankA.id,
    bankBId: bankB.id,
    categoryBId: categoryB.id,
    projectBId: projectB.id,
    expenseBId: expenseB.id,
    foreignNames
  };
});

afterAll(async () => {
  for (const context of contexts) {
    await cleanupAuditContext(context);
  }
});

describe("transaction draft PostgreSQL ownership", () => {
  it("prevents cross-user list, edit, dismiss, and same-capture overwrite", async () => {
    const captureKey = randomUUID();
    authState.userId = fixtures.context.userA.id;
    const savedA = await savePasteDrafts({
      captureKey,
      rows: [expenseDraft(captureKey, fixtures.bankAId, { title: "User A only" })]
    });
    expect(savedA).toMatchObject({
      ok: true,
      drafts: [{ status: "READY", amountText: "90071992547409.99" }]
    });
    if (!savedA.ok) throw new Error(savedA.error);
    const draftAId = savedA.drafts[0].id;

    authState.userId = fixtures.context.userB.id;
    await expect(listTransactionDrafts(captureKey)).resolves.toEqual({
      ok: true,
      drafts: []
    });
    await expect(
      updateTransactionDraft(draftAId, { title: "Stolen update" })
    ).resolves.toEqual({ ok: false, error: "Draft not found." });
    await expect(dismissTransactionDrafts([draftAId])).resolves.toEqual({
      ok: true,
      dismissedCount: 0
    });
    await expect(
      savePasteDrafts({
        captureKey,
        rows: [
          expenseDraft(captureKey, fixtures.bankBId, { title: "User B same capture" })
        ]
      })
    ).resolves.toMatchObject({ ok: true, drafts: [{ title: "User B same capture" }] });

    const persisted = await prisma.transactionDraft.findMany({
      where: { captureKey },
      orderBy: { userId: "asc" },
      select: {
        userId: true,
        title: true,
        amountText: true,
        createdAt: true,
        expiresAt: true
      }
    });
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: fixtures.context.userA.id,
          title: "User A only",
          amountText: "90071992547409.99"
        }),
        expect.objectContaining({
          userId: fixtures.context.userB.id,
          title: "User B same capture",
          amountText: "90071992547409.99"
        })
      ])
    );
    const userADraft = persisted.find(
      ({ userId }) => userId === fixtures.context.userA.id
    );
    expect(
      userADraft && userADraft.expiresAt.getTime() - userADraft.createdAt.getTime()
    ).toBe(30 * 24 * 60 * 60 * 1_000);
  }, 20_000);

  it("isolates direct draft operations and batch replay keys between two users", async () => {
    const context = await createAuditContext(`draft-matrix-${randomUUID()}`);
    contexts.push(context);
    const captureKey = randomUUID();
    const idempotencyKey = randomUUID();
    const [bankA, bankB] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: `Matrix bank A ${captureKey}`,
          type: MoneySourceType.BANK_ACCOUNT
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userB.id,
          name: `Matrix bank B ${captureKey}`,
          type: MoneySourceType.BANK_ACCOUNT
        }
      })
    ]);

    authState.userId = context.userA.id;
    const savedA = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, bankA.id, {
          amountText: "11.11",
          title: `Matrix A ${captureKey}`,
          rawRow: { Amount: "11.11" }
        })
      ]
    });
    expect(savedA).toMatchObject({ ok: true, drafts: [{ status: "READY" }] });
    if (!savedA.ok) throw new Error(savedA.error);
    const draftAId = savedA.drafts[0].id;

    authState.userId = context.userB.id;
    await expect(listTransactionDrafts(captureKey)).resolves.toEqual({
      ok: true,
      drafts: []
    });
    await expect(
      updateTransactionDraft(draftAId, { title: "Foreign rewrite" })
    ).resolves.toEqual({ ok: false, error: "Draft not found." });
    await expect(dismissTransactionDrafts([draftAId])).resolves.toEqual({
      ok: true,
      dismissedCount: 0
    });
    await expect(
      importTransactionDrafts({ ids: [draftAId], idempotencyKey })
    ).resolves.toEqual({
      ok: false,
      error: "Review every selected draft before saving."
    });
    await expect(
      prisma.transactionImportBatch.count({
        where: { userId: context.userB.id, idempotencyKey }
      })
    ).resolves.toBe(0);

    const savedB = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, bankB.id, {
          amountText: "22.22",
          title: `Matrix B ${captureKey}`,
          rawRow: { Amount: "22.22" }
        })
      ]
    });
    expect(savedB).toMatchObject({ ok: true, drafts: [{ status: "READY" }] });
    if (!savedB.ok) throw new Error(savedB.error);
    const draftBId = savedB.drafts[0].id;
    await expect(listTransactionDrafts(captureKey)).resolves.toMatchObject({
      ok: true,
      drafts: [{ id: draftBId, title: `Matrix B ${captureKey}` }]
    });
    const importedB = await importTransactionDrafts({
      ids: [draftBId],
      idempotencyKey
    });
    expect(importedB).toMatchObject({ ok: true, importedCount: 1 });
    if (!importedB.ok) throw new Error(importedB.error);

    authState.userId = context.userA.id;
    const importedA = await importTransactionDrafts({
      ids: [draftAId],
      idempotencyKey
    });
    expect(importedA).toMatchObject({ ok: true, importedCount: 1 });
    if (!importedA.ok) throw new Error(importedA.error);
    await expect(
      importTransactionDrafts({ ids: [draftAId], idempotencyKey })
    ).resolves.toEqual(importedA);
    await expect(listTransactionDrafts(captureKey)).resolves.toMatchObject({
      ok: true,
      drafts: [
        {
          id: draftAId,
          status: TransactionDraftStatus.IMPORTED,
          importedTransactionId: importedA.transactionIds[0]
        }
      ]
    });

    const batches = await prisma.transactionImportBatch.findMany({
      where: {
        userId: { in: [context.userA.id, context.userB.id] },
        idempotencyKey
      },
      orderBy: { userId: "asc" }
    });
    expect(batches).toHaveLength(2);
    expect(batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: context.userA.id,
          draftIds: [draftAId],
          transactionIds: importedA.transactionIds
        }),
        expect.objectContaining({
          userId: context.userB.id,
          draftIds: [draftBId],
          transactionIds: importedB.transactionIds
        })
      ])
    );

    authState.userId = context.userB.id;
    const foreignReplay = await importTransactionDrafts({
      ids: [draftAId],
      idempotencyKey
    });
    expect(foreignReplay).toEqual({
      ok: false,
      error: "This save key was already used for another selection."
    });
    expect(JSON.stringify(foreignReplay)).not.toContain(
      importedA.transactionIds[0]
    );
    expect(JSON.stringify(foreignReplay)).not.toContain(`Matrix A ${captureKey}`);
  }, 30_000);

  it.each([
    TransactionDraftStatus.IMPORTING,
    TransactionDraftStatus.IMPORTED,
    TransactionDraftStatus.DISMISSED
  ])("rejects a direct edit of an owned %s draft", async (status) => {
    const captureKey = randomUUID();
    authState.userId = fixtures.context.userA.id;
    const saved = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, fixtures.bankAId, {
          title: `Terminal ${status} ${captureKey}`
        })
      ]
    });
    expect(saved).toMatchObject({ ok: true, drafts: [{ status: "READY" }] });
    if (!saved.ok) throw new Error(saved.error);
    const draftId = saved.drafts[0].id;
    await prisma.transactionDraft.update({
      where: { id: draftId },
      data: { status }
    });
    const dismissalActivitiesBefore = await prisma.activityLog.count({
      where: {
        userId: fixtures.context.userA.id,
        action: "TRANSACTION_DRAFTS_DISMISSED"
      }
    });

    await expect(
      updateTransactionDraft(draftId, { title: `Rewritten ${status}` })
    ).resolves.toEqual({ ok: false, error: "Draft not found." });
    await expect(dismissTransactionDrafts([draftId])).resolves.toEqual({
      ok: true,
      dismissedCount: 0
    });
    await expect(
      prisma.transactionDraft.findUniqueOrThrow({
        where: { id: draftId },
        select: { status: true, title: true }
      })
    ).resolves.toEqual({
      status,
      title: `Terminal ${status} ${captureKey}`
    });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "TRANSACTION_DRAFTS_DISMISSED"
        }
      })
    ).resolves.toBe(dismissalActivitiesBefore);
  });

  it.each([
    TransactionDraftStatus.IMPORTING,
    TransactionDraftStatus.IMPORTED,
    TransactionDraftStatus.DISMISSED
  ])("does not reuse an owned %s PASTE position", async (status) => {
    const captureKey = randomUUID();
    authState.userId = fixtures.context.userA.id;
    const originalTitle = `Paste lifecycle ${status} ${captureKey}`;
    const saved = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, fixtures.bankAId, { title: originalTitle })
      ]
    });
    expect(saved).toMatchObject({ ok: true, drafts: [{ status: "READY" }] });
    if (!saved.ok) throw new Error(saved.error);
    await prisma.transactionDraft.update({
      where: { id: saved.drafts[0].id },
      data: { status }
    });

    const replacement = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, fixtures.bankAId, {
          title: `Reopened paste ${status}`
        })
      ]
    });

    expect(replacement).toMatchObject({ ok: false });
    await expect(
      prisma.transactionDraft.findUniqueOrThrow({
        where: { id: saved.drafts[0].id },
        select: { status: true, title: true }
      })
    ).resolves.toEqual({ status, title: originalTitle });
  });

  it.each([
    TransactionDraftStatus.IMPORTING,
    TransactionDraftStatus.IMPORTED,
    TransactionDraftStatus.DISMISSED
  ])("does not reuse an owned %s QUICK position", async (status) => {
    const captureKey = randomUUID();
    authState.userId = fixtures.context.userA.id;
    const originalTitle = `Quick lifecycle ${status} ${captureKey}`;
    const saved = await saveQuickDraft(
      expenseDraft(captureKey, fixtures.bankAId, {
        origin: TransactionDraftOrigin.QUICK,
        title: originalTitle
      })
    );
    expect(saved).toMatchObject({ ok: true, draft: { status: "READY" } });
    if (!saved.ok) throw new Error(saved.error);
    await prisma.transactionDraft.update({
      where: { id: saved.draft.id },
      data: { status }
    });

    const replacement = await saveQuickDraft(
      expenseDraft(captureKey, fixtures.bankAId, {
        origin: TransactionDraftOrigin.QUICK,
        title: `Reopened quick ${status}`
      })
    );

    expect(replacement).toMatchObject({ ok: false });
    await expect(
      prisma.transactionDraft.findUniqueOrThrow({
        where: { id: saved.draft.id },
        select: { status: true, title: true }
      })
    ).resolves.toEqual({ status, title: originalTitle });
  });

  it("rejects a mixed terminal PASTE capture without changing an editable sibling", async () => {
    const captureKey = randomUUID();
    authState.userId = fixtures.context.userA.id;
    const saved = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, fixtures.bankAId, { title: "Editable head" }),
        expenseDraft(captureKey, fixtures.bankAId, {
          position: 1,
          title: "Terminal surplus"
        })
      ]
    });
    expect(saved).toMatchObject({ ok: true });
    if (!saved.ok) throw new Error(saved.error);
    await prisma.transactionDraft.update({
      where: { id: saved.drafts[1].id },
      data: { status: TransactionDraftStatus.IMPORTED }
    });

    const replacement = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, fixtures.bankAId, {
          title: "Replaced editable head"
        })
      ]
    });
    expect(replacement).toMatchObject({ ok: false });
    await expect(
      prisma.transactionDraft.findMany({
        where: { id: { in: saved.drafts.map(({ id }) => id) } },
        orderBy: { position: "asc" },
        select: { status: true, title: true }
      })
    ).resolves.toEqual([
      { status: TransactionDraftStatus.READY, title: "Editable head" },
      {
        status: TransactionDraftStatus.IMPORTED,
        title: "Terminal surplus"
      }
    ]);
  });

  it("keeps foreign references in review without creating a transaction or leaking names", async () => {
    const captureKey = randomUUID();
    authState.userId = fixtures.context.userA.id;
    const transactionsBefore = await prisma.transaction.count({
      where: { userId: fixtures.context.userA.id }
    });

    const result = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, fixtures.bankAId, {
          type: TransactionType.REFUND,
          fromMoneySourceId: null,
          toMoneySourceId: fixtures.bankBId,
          categoryId: fixtures.categoryBId,
          projectId: fixtures.projectBId,
          relatedTransactionId: fixtures.expenseBId,
          title: "Foreign reference probe"
        })
      ]
    });

    expect(result).toMatchObject({
      ok: true,
      drafts: [
        {
          status: "NEEDS_REVIEW",
          issues: expect.arrayContaining([
            expect.objectContaining({ field: "categoryId" }),
            expect.objectContaining({ field: "toMoneySourceId" }),
            expect.objectContaining({ field: "projectId" }),
            expect.objectContaining({ field: "relatedTransactionId" })
          ])
        }
      ]
    });
    const serialized = JSON.stringify(result);
    fixtures.foreignNames.forEach((name) => expect(serialized).not.toContain(name));
    await expect(
      prisma.transaction.count({ where: { userId: fixtures.context.userA.id } })
    ).resolves.toBe(transactionsBefore);
  }, 20_000);

  it("persists only SHA-256 fingerprints and requires explicit duplicate confirmation", async () => {
    const captureKey = randomUUID();
    authState.userId = fixtures.context.userA.id;
    const result = await savePasteDrafts({
      captureKey,
      rows: [
        expenseDraft(captureKey, fixtures.bankAId),
        expenseDraft(captureKey, fixtures.bankAId, { position: 1 })
      ]
    });

    expect(result).toMatchObject({
      ok: true,
      drafts: [
        { position: 0, status: "READY", possibleDuplicate: false },
        { position: 1, status: "NEEDS_REVIEW", possibleDuplicate: true }
      ]
    });
    if (!result.ok) throw new Error(result.error);
    const stored = await prisma.transactionDraft.findMany({
      where: { userId: fixtures.context.userA.id, captureKey },
      orderBy: { position: "asc" },
      select: { id: true, duplicateFingerprint: true }
    });
    expect(stored.map(({ duplicateFingerprint }) => duplicateFingerprint)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/)
    ]);
    expect(stored[0].duplicateFingerprint).toBe(stored[1].duplicateFingerprint);
    expect(stored[0].duplicateFingerprint).not.toContain("90071992547409.99");

    const separated = await updateTransactionDraft(stored[0].id, {
      title: "Audit lunch separated"
    });
    expect(separated).toMatchObject({
      ok: true,
      draft: { id: stored[0].id, status: "READY" },
      drafts: [
        { id: stored[0].id, status: "READY", possibleDuplicate: false },
        { id: stored[1].id, status: "READY", possibleDuplicate: false }
      ]
    });

    const reunited = await updateTransactionDraft(stored[0].id, {
      title: "Audit lunch"
    });
    expect(reunited).toMatchObject({
      ok: true,
      draft: { id: stored[0].id, status: "READY" },
      drafts: [
        { id: stored[0].id, status: "READY", possibleDuplicate: false },
        {
          id: stored[1].id,
          status: "NEEDS_REVIEW",
          possibleDuplicate: true
        }
      ]
    });

    const confirmed = await updateTransactionDraft(stored[1].id, {
      duplicateConfirmed: true
    });
    expect(confirmed).toMatchObject({
      ok: true,
      draft: { id: stored[1].id, status: "READY" },
      drafts: [
        { id: stored[0].id, status: "READY", possibleDuplicate: false },
        { id: stored[1].id, status: "READY", possibleDuplicate: false }
      ]
    });
  }, 20_000);
});

describe("transaction draft PostgreSQL import atomicity", () => {
  it("does not reopen an imported sibling after reassessment snapshots it", async () => {
    authState.userId = fixtures.context.userA.id;
    const [editedDraft, importedSibling] = await saveReadyExpenseDrafts(2);
    const editedTitle = `Edited while sibling imports ${randomUUID()}`;
    const gateNamespace = 118_733;
    const markerNamespace = 118_734;
    const gateKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const markerKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const uninstallGate = await installReassessmentWriteGate(
      editedDraft.id,
      editedTitle,
      gateNamespace,
      gateKey,
      markerNamespace,
      markerKey
    );
    let releaseGate: () => void = () => undefined;
    let signalGateHeld: () => void = () => undefined;
    const gateHeld = new Promise<void>((resolve) => {
      signalGateHeld = resolve;
    });
    const gateReleased = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const heldGate = prisma.$transaction(
      async (db) => {
        await db.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${gateNamespace}, ${gateKey})`
        );
        signalGateHeld();
        await gateReleased;
      },
      { timeout: 20_000 }
    );
    let reassessmentPromise: ReturnType<typeof updateTransactionDraft> | null = null;

    try {
      await gateHeld;
      reassessmentPromise = updateTransactionDraft(editedDraft.id, {
        title: editedTitle
      });
      await waitForAdvisoryLock(markerNamespace, markerKey);

      const imported = await importTransactionDrafts({
        ids: [importedSibling.id],
        idempotencyKey: randomUUID()
      });
      expect(imported).toMatchObject({ ok: true, importedCount: 1 });
      releaseGate();

      const reassessed = await reassessmentPromise;
      expect(reassessed).toMatchObject({
        ok: true,
        draft: { id: editedDraft.id, status: TransactionDraftStatus.READY },
        drafts: expect.arrayContaining([
          expect.objectContaining({
            id: importedSibling.id,
            status: TransactionDraftStatus.IMPORTED
          })
        ])
      });
      await expect(
        prisma.transactionDraft.findUniqueOrThrow({
          where: { id: importedSibling.id },
          select: {
            status: true,
            importBatchId: true,
            importedTransactionId: true,
            title: true
          }
        })
      ).resolves.toEqual({
        status: TransactionDraftStatus.IMPORTED,
        importBatchId: expect.any(String),
        importedTransactionId: expect.any(String),
        title: null
      });
    } finally {
      releaseGate();
      await reassessmentPromise?.catch(() => undefined);
      await heldGate.catch(() => undefined);
      await uninstallGate();
    }
  }, 30_000);

  it("does not reopen a draft when save overlaps its import transition", async () => {
    authState.userId = fixtures.context.userA.id;
    const [draft] = await saveReadyExpenseDrafts(1);
    const gateNamespace = 118_731;
    const markerNamespace = 118_732;
    const gateKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const markerKey = Math.floor(Math.random() * 1_000_000_000) + 1;
    const uninstallGate = await installImportLifecycleGate(
      draft.id,
      gateNamespace,
      gateKey,
      markerNamespace,
      markerKey
    );
    let releaseGate: () => void = () => undefined;
    let signalGateHeld: () => void = () => undefined;
    const gateHeld = new Promise<void>((resolve) => {
      signalGateHeld = resolve;
    });
    const gateReleased = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const heldGate = prisma.$transaction(
      async (db) => {
        await db.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${gateNamespace}, ${gateKey})`
        );
        signalGateHeld();
        await gateReleased;
      },
      { timeout: 20_000 }
    );

    try {
      await gateHeld;
      const importPromise = importTransactionDrafts({
        ids: [draft.id],
        idempotencyKey: randomUUID()
      });
      await waitForAdvisoryLock(markerNamespace, markerKey);
      let saveSettled = false;
      const savePromise = savePasteDrafts({
        captureKey: draft.captureKey,
        rows: [
          expenseDraft(draft.captureKey, fixtures.bankAId, {
            title: "Concurrent lifecycle overwrite"
          })
        ]
      }).finally(() => {
        saveSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(saveSettled).toBe(false);
      releaseGate();

      const [imported, resaved] = await Promise.all([
        importPromise,
        savePromise,
        heldGate
      ]).then(([importResult, saveResult]) => [importResult, saveResult]);
      expect(imported).toMatchObject({ ok: true, importedCount: 1 });
      expect(resaved).toMatchObject({ ok: false });
      await expect(
        prisma.transactionDraft.findUniqueOrThrow({
          where: { id: draft.id },
          select: {
            status: true,
            importedTransactionId: true,
            title: true
          }
        })
      ).resolves.toEqual({
        status: TransactionDraftStatus.IMPORTED,
        importedTransactionId: expect.any(String),
        title: null
      });
    } finally {
      releaseGate();
      await heldGate.catch(() => undefined);
      await uninstallGate();
    }
  }, 30_000);

  it("imports the selected READY drafts once and replays the completed result", async () => {
    authState.userId = fixtures.context.userA.id;
    const drafts = await saveReadyExpenseDrafts(2);
    const ids = drafts.map(({ id }) => id);
    const idempotencyKey = randomUUID();

    const first = await importTransactionDrafts({ ids, idempotencyKey });
    const replay = await importTransactionDrafts({
      ids: [...ids].reverse(),
      idempotencyKey
    });

    expect(first).toMatchObject({ ok: true, importedCount: 2 });
    if (!first.ok) throw new Error(first.error);
    expect(replay).toEqual(first);
    await expect(
      prisma.transaction.count({
        where: { id: { in: first.transactionIds }, userId: fixtures.context.userA.id }
      })
    ).resolves.toBe(2);

    const batch = await prisma.transactionImportBatch.findUniqueOrThrow({
      where: {
        userId_idempotencyKey: {
          userId: fixtures.context.userA.id,
          idempotencyKey
        }
      }
    });
    expect(batch).toMatchObject({
      origin: TransactionDraftOrigin.PASTE,
      status: "IMPORTED",
      draftIds: ids,
      transactionIds: first.transactionIds
    });
    const importedDrafts = await prisma.transactionDraft.findMany({
      where: { id: { in: ids }, userId: fixtures.context.userA.id },
      orderBy: { position: "asc" }
    });
    expect(importedDrafts).toEqual(
      ids.map((id, index) =>
        expect.objectContaining({
          id,
          status: TransactionDraftStatus.IMPORTED,
          importBatchId: batch.id,
          importedTransactionId: first.transactionIds[index],
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
          recurringPaymentId: null,
          isInstallmentRelated: false,
          duplicateFingerprint: null,
          duplicateConfirmed: false,
          validationIssues: [],
          rawRow: null
        })
      )
    );
    const activities = await prisma.activityLog.findMany({
      where: {
        userId: fixtures.context.userA.id,
        OR: [
          { entityId: { in: first.transactionIds } },
          { entityId: batch.id }
        ]
      },
      orderBy: { createdAt: "asc" }
    });
    expect(activities.map(({ action }) => action).sort()).toEqual([
      "TRANSACTION_BATCH_IMPORTED",
      "TRANSACTION_CREATED",
      "TRANSACTION_CREATED"
    ]);
    const batchActivity = activities.find(({ entityId }) => entityId === batch.id);
    expect(batchActivity).toMatchObject({
      action: "TRANSACTION_BATCH_IMPORTED",
      entityType: "TransactionImportBatch",
      metadata: { origin: "PASTE", count: 2 }
    });
    expect(batchActivity?.metadata).toEqual({ origin: "PASTE", count: 2 });
    const serializedBatchActivity = JSON.stringify(batchActivity);
    drafts.forEach((draft) => {
      expect(serializedBatchActivity).not.toContain(draft.id);
      expect(serializedBatchActivity).not.toContain(draft.title);
      expect(serializedBatchActivity).not.toContain(draft.amountText);
    });
  }, 20_000);

  it("rolls back transactions, batch, activity, and draft changes when activity fails", async () => {
    authState.userId = fixtures.context.userA.id;
    const drafts = await saveReadyExpenseDrafts(2);
    const ids = drafts.map(({ id }) => id);
    const idempotencyKey = randomUUID();
    const before = await Promise.all([
      prisma.transaction.count({ where: { userId: fixtures.context.userA.id } }),
      prisma.transactionImportBatch.count({
        where: { userId: fixtures.context.userA.id }
      }),
      prisma.activityLog.count({ where: { userId: fixtures.context.userA.id } })
    ]);
    const uninstallFailure = await installDraftImportActivityFailure(
      fixtures.context.userA.id
    );

    try {
      await expect(
        importTransactionDrafts({ ids, idempotencyKey })
      ).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    await expect(
      Promise.all([
        prisma.transaction.count({ where: { userId: fixtures.context.userA.id } }),
        prisma.transactionImportBatch.count({
          where: { userId: fixtures.context.userA.id }
        }),
        prisma.activityLog.count({ where: { userId: fixtures.context.userA.id } })
      ])
    ).resolves.toEqual(before);
    await expect(
      prisma.transactionDraft.findMany({
        where: { id: { in: ids }, userId: fixtures.context.userA.id },
        orderBy: { position: "asc" },
        select: {
          status: true,
          importBatchId: true,
          importedTransactionId: true,
          amountText: true,
          title: true,
          rawRow: true
        }
      })
    ).resolves.toEqual(
      drafts.map((draft) => ({
        status: TransactionDraftStatus.READY,
        importBatchId: null,
        importedTransactionId: null,
        amountText: draft.amountText,
        title: draft.title,
        rawRow: draft.rawRow
      }))
    );

    await expect(
      importTransactionDrafts({ ids, idempotencyKey })
    ).resolves.toMatchObject({ ok: true, importedCount: 2 });
  }, 20_000);

  it("imports a literal five-type batch through every downstream financial view", async () => {
    const context = await createAuditContext(`draft-ledger-${randomUUID()}`);
    contexts.push(context);
    authState.userId = context.userA.id;
    const suffix = randomUUID();
    const [bank, card, category, project] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: `Batch bank ${suffix}`,
          type: MoneySourceType.BANK_ACCOUNT,
          openingBalance: "1000.00"
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: `Batch card ${suffix}`,
          type: MoneySourceType.CREDIT_CARD,
          creditLimit: "500.00",
          initialOutstandingDebt: "50.00",
          initialCardCredit: "20.00",
          annualFeeWaiverEnabled: true,
          annualFeeWaiverSpendTarget: "200.00",
          waiverPeriodStartDate: new Date("2026-08-01T00:00:00.000Z"),
          waiverPeriodEndDate: new Date("2026-08-31T00:00:00.000Z")
        }
      }),
      prisma.category.create({
        data: {
          userId: context.userA.id,
          name: `Batch eligible ${suffix}`,
          type: CategoryType.EXPENSE,
          defaultQualityRating: QualityRating.A,
          defaultCountTowardFeeWaiver: true
        }
      }),
      prisma.financialProject.create({
        data: {
          userId: context.userA.id,
          name: `Batch project ${suffix}`
        }
      })
    ]);
    const originalExpense = await prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.EXPENSE,
        amount: "30.00",
        title: `Batch original expense ${suffix}`,
        description: "Original card expense description",
        transactionDate: new Date("2026-08-09T00:00:00.000Z"),
        createdAt: new Date("2026-08-09T09:00:00.000Z"),
        categoryId: category.id,
        qualityRating: QualityRating.A,
        fromMoneySourceId: card.id,
        projectId: project.id,
        countTowardFeeWaiver: true
      }
    });
    const captureKey = randomUUID();
    const titles = {
      income: `Batch exact income ${suffix}`,
      expense: `Batch card expense ${suffix}`,
      transfer: `Batch card payment ${suffix}`,
      refund: `Batch card refund ${suffix}`,
      adjustment: `Batch card credit adjustment ${suffix}`
    };
    const rows: TransactionDraftInput[] = [
      expenseDraft(captureKey, bank.id, {
        position: 0,
        type: TransactionType.INCOME,
        amountText: "90071992547409.99",
        title: titles.income,
        description: "Exact income description",
        transactionDateText: "2026-08-10",
        fromMoneySourceId: null,
        toMoneySourceId: bank.id,
        projectId: project.id,
        rawRow: { Amount: "90071992547409.99" }
      }),
      expenseDraft(captureKey, card.id, {
        position: 1,
        amountText: "45.25",
        title: titles.expense,
        description: "Card expense description",
        transactionDateText: "2026-08-11",
        categoryId: category.id,
        qualityRating: QualityRating.A,
        projectId: project.id,
        countTowardFeeWaiver: null,
        rawRow: { Amount: "45.25" }
      }),
      expenseDraft(captureKey, bank.id, {
        position: 2,
        type: TransactionType.TRANSFER,
        amountText: "100.00",
        title: titles.transfer,
        description: "Card payment description",
        transactionDateText: "2026-08-12",
        toMoneySourceId: card.id,
        rawRow: { Amount: "100.00" }
      }),
      expenseDraft(captureKey, bank.id, {
        position: 3,
        type: TransactionType.REFUND,
        amountText: "10.25",
        title: titles.refund,
        description: "Card refund description",
        transactionDateText: "2026-08-13",
        fromMoneySourceId: null,
        toMoneySourceId: card.id,
        relatedTransactionId: originalExpense.id,
        rawRow: { Amount: "10.25" }
      }),
      expenseDraft(captureKey, bank.id, {
        position: 4,
        type: TransactionType.ADJUSTMENT,
        amountText: "2.00",
        title: titles.adjustment,
        description: "Card credit adjustment description",
        transactionDateText: "2026-08-14",
        fromMoneySourceId: null,
        adjustedMoneySourceId: card.id,
        adjustmentDirection: AdjustmentDirection.DECREASE,
        adjustmentTarget: AdjustmentTarget.CARD_CREDIT,
        rawRow: { Amount: "2.00" }
      })
    ];
    const saved = await savePasteDrafts({ captureKey, rows });
    expect(saved).toMatchObject({ ok: true });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.drafts.map(({ status }) => status)).toEqual([
      TransactionDraftStatus.READY,
      TransactionDraftStatus.READY,
      TransactionDraftStatus.READY,
      TransactionDraftStatus.READY,
      TransactionDraftStatus.READY
    ]);

    const idempotencyKey = randomUUID();
    const imported = await importTransactionDrafts({
      ids: saved.drafts.map(({ id }) => id),
      idempotencyKey
    });
    expect(imported).toMatchObject({ ok: true, importedCount: 5 });
    if (!imported.ok) throw new Error(imported.error);
    const importedCreatedAt = [
      "2026-08-10T10:00:00.000Z",
      "2026-08-11T11:00:00.000Z",
      "2026-08-12T12:00:00.000Z",
      "2026-08-13T13:00:00.000Z",
      "2026-08-14T14:00:00.000Z"
    ];
    await prisma.$transaction(
      imported.transactionIds.map((id, index) =>
        prisma.transaction.update({
          where: { id },
          data: { createdAt: new Date(importedCreatedAt[index]) }
        })
      )
    );
    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: imported.transactionIds },
        userId: context.userA.id
      },
      orderBy: { transactionDate: "asc" }
    });
    expect(transactions).toHaveLength(5);
    expect(transactions[0]).toMatchObject({
      type: TransactionType.INCOME,
      fromMoneySourceId: null,
      toMoneySourceId: bank.id,
      projectId: project.id,
      qualityRating: null,
      countTowardFeeWaiver: false
    });
    expect(transactions[0].amount.toFixed(2)).toBe("90071992547409.99");
    expect(transactions[1]).toMatchObject({
      type: TransactionType.EXPENSE,
      fromMoneySourceId: card.id,
      toMoneySourceId: null,
      categoryId: category.id,
      qualityRating: QualityRating.A,
      projectId: project.id,
      countTowardFeeWaiver: true
    });
    expect(transactions[2]).toMatchObject({
      type: TransactionType.TRANSFER,
      fromMoneySourceId: bank.id,
      toMoneySourceId: card.id,
      countTowardFeeWaiver: false
    });
    expect(transactions[3]).toMatchObject({
      type: TransactionType.REFUND,
      fromMoneySourceId: null,
      toMoneySourceId: card.id,
      relatedTransactionId: originalExpense.id,
      countTowardFeeWaiver: false
    });
    expect(transactions[4]).toMatchObject({
      type: TransactionType.ADJUSTMENT,
      fromMoneySourceId: null,
      toMoneySourceId: null,
      adjustedMoneySourceId: card.id,
      adjustmentDirection: AdjustmentDirection.DECREASE,
      adjustmentTarget: AdjustmentTarget.CARD_CREDIT,
      countTowardFeeWaiver: false
    });

    const [dashboard, incomeExpense, categories, qualities, projects, sources, cards, waivers] =
      await Promise.all([
        getDashboardData("2026-08-01", "2026-08-31"),
        loadIncomeVsExpenseOverTime({
          startDate: "2026-08-01",
          endDate: "2026-08-31"
        }),
        loadExpenseByCategory({
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          categoryId: category.id
        }),
        loadSpendingQualityBreakdown({
          startDate: "2026-08-01",
          endDate: "2026-08-31"
        }),
        loadProjectProfitLoss({
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          projectId: project.id
        }),
        loadSpendingBySource({
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          moneySourceId: card.id
        }),
        loadCreditCardDebtReport({
          endDate: "2026-08-31",
          moneySourceId: card.id
        }),
        loadFeeWaiverReport({ moneySourceId: card.id })
      ]);
    const dashboardBank = dashboard.moneySources.find(({ id }) => id === bank.id);
    const dashboardCard = dashboard.creditCards.find(
      ({ source }) => source.id === card.id
    );
    const dashboardWaiver = dashboard.feeWaivers.find(
      ({ source }) => source.id === card.id
    );
    if (!dashboardBank || !dashboardCard || !dashboardWaiver) {
      throw new Error("Expected imported ledger projections.");
    }
    expect(
      calculateAccountProjection(dashboardBank, dashboard.transactions).trackedAmount.toFixed(2)
    ).toBe("90071992548309.99");
    expect({
      outstandingDebt: dashboardCard.state.outstandingDebt.toFixed(2),
      cardCredit: dashboardCard.state.cardCredit.toFixed(2),
      availableCredit: dashboardCard.state.availableCredit.toFixed(2)
    }).toEqual({
      outstandingDebt: "0.00",
      cardCredit: "3.00",
      availableCredit: "500.00"
    });
    expect({
      eligibleSpending: dashboardWaiver.state.eligibleSpending.toFixed(2),
      progress: dashboardWaiver.state.progress.toFixed(2),
      remaining: dashboardWaiver.state.remaining.toFixed(2)
    }).toEqual({
      eligibleSpending: "65.00",
      progress: "32.50",
      remaining: "135.00"
    });
    expect({
      totalIncome: dashboard.summary.totalIncome.toFixed(2),
      totalExpense: dashboard.summary.totalExpense.toFixed(2),
      netSavings: dashboard.summary.netSavings.toFixed(2),
      highQualityPercent: dashboard.summary.highQualityPercent.toFixed(2),
      lowQualityAmount: dashboard.summary.lowQualityAmount.toFixed(2),
      estimatedNetPosition: dashboard.summary.estimatedNetPosition.toFixed(2),
      cardSpend: dashboard.summary.spendingBySource[card.id]?.toFixed(2)
    }).toEqual({
      totalIncome: "90071992547409.99",
      totalExpense: "75.25",
      netSavings: "90071992547334.74",
      highQualityPercent: "100.00",
      lowQualityAmount: "0.00",
      estimatedNetPosition: "90071992548309.99",
      cardSpend: "75.25"
    });

    expect(
      incomeExpense.map(({ period, income, expense }) => ({
        period,
        income: income.toFixed(2),
        expense: expense.toFixed(2)
      }))
    ).toEqual([
      {
        period: "2026-08",
        income: "90071992547409.99",
        expense: "65.00"
      }
    ]);
    expect(
      categories.map(({ categoryName, total }) => ({
        categoryName,
        total: total.toFixed(2)
      }))
    ).toEqual([{ categoryName: category.name, total: "65.00" }]);
    expect(
      qualities.map(({ rating, count, total }) => ({
        rating,
        count,
        total: total.toFixed(2)
      }))
    ).toEqual([{ rating: QualityRating.A, count: 2, total: "65.00" }]);
    expect(
      projects.map(({ projectName, totalIncome, totalExpense, profit }) => ({
        projectName,
        totalIncome: totalIncome.toFixed(2),
        totalExpense: totalExpense.toFixed(2),
        profit: profit.toFixed(2)
      }))
    ).toEqual([
      {
        projectName: project.name,
        totalIncome: "90071992547409.99",
        totalExpense: "65.00",
        profit: "90071992547344.99"
      }
    ]);
    expect(
      sources.map(({ sourceName, total }) => ({
        sourceName,
        total: total.toFixed(2)
      }))
    ).toEqual([{ sourceName: card.name, total: "65.00" }]);
    expect({
      outstandingDebt: cards[0]?.state.outstandingDebt.toFixed(2),
      cardCredit: cards[0]?.state.cardCredit.toFixed(2),
      availableCredit: cards[0]?.state.availableCredit.toFixed(2),
      eligibleSpending: waivers[0]?.state.eligibleSpending.toFixed(2),
      remaining: waivers[0]?.state.remaining.toFixed(2)
    }).toEqual({
      outstandingDebt: "0.00",
      cardCredit: "3.00",
      availableCredit: "500.00",
      eligibleSpending: "65.00",
      remaining: "135.00"
    });

    const response = await exportTransactions(
      new Request(
        "http://localhost/api/export/transactions?startDate=2026-08-01&endDate=2026-08-31"
      )
    );
    const csv = await response.text();
    const csvRows = parseCsv(csv);
    expect(response.status).toBe(200);
    expect(csvRows[0]).toEqual([
      "Date",
      "Type",
      "Title",
      "Amount",
      "Currency",
      "Category",
      "Quality Rating",
      "From Source",
      "To Source",
      "Project",
      "Description",
      "Count Toward Fee Waiver",
      "Created At"
    ]);
    expect(csvRows).toHaveLength(7);
    expect(csvRows.slice(1).every((row) => row.length === 13)).toBe(true);
    expect(
      Object.fromEntries(
        csvRows.slice(1).map((row) => [row[2], row])
      )
    ).toEqual({
      [originalExpense.title]: [
        "2026-08-09T00:00:00.000Z",
        "EXPENSE",
        originalExpense.title,
        "30",
        "VND",
        category.name,
        "A",
        card.name,
        "",
        project.name,
        "Original card expense description",
        "true",
        "2026-08-09T09:00:00.000Z"
      ],
      [titles.income]: [
        "2026-08-10T00:00:00.000Z",
        "INCOME",
        titles.income,
        "90071992547409.99",
        "VND",
        "",
        "",
        "",
        bank.name,
        project.name,
        "Exact income description",
        "false",
        importedCreatedAt[0]
      ],
      [titles.expense]: [
        "2026-08-11T00:00:00.000Z",
        "EXPENSE",
        titles.expense,
        "45.25",
        "VND",
        category.name,
        "A",
        card.name,
        "",
        project.name,
        "Card expense description",
        "true",
        importedCreatedAt[1]
      ],
      [titles.transfer]: [
        "2026-08-12T00:00:00.000Z",
        "TRANSFER",
        titles.transfer,
        "100",
        "VND",
        "",
        "",
        bank.name,
        card.name,
        "",
        "Card payment description",
        "false",
        importedCreatedAt[2]
      ],
      [titles.refund]: [
        "2026-08-13T00:00:00.000Z",
        "REFUND",
        titles.refund,
        "10.25",
        "VND",
        "",
        "",
        "",
        card.name,
        "",
        "Card refund description",
        "false",
        importedCreatedAt[3]
      ],
      [titles.adjustment]: [
        "2026-08-14T00:00:00.000Z",
        "ADJUSTMENT",
        titles.adjustment,
        "2",
        "VND",
        "",
        "",
        "",
        "",
        "",
        "Card credit adjustment description",
        "false",
        importedCreatedAt[4]
      ]
    });

    const batch = await prisma.transactionImportBatch.findUniqueOrThrow({
      where: {
        userId_idempotencyKey: {
          userId: context.userA.id,
          idempotencyKey
        }
      }
    });
    const activities = await prisma.activityLog.findMany({
      where: {
        userId: context.userA.id,
        entityId: { in: [...imported.transactionIds, batch.id] }
      },
      select: { action: true, entityId: true, metadata: true }
    });
    expect(activities).toHaveLength(6);
    expect(
      activities.find(({ entityId }) => entityId === batch.id)
    ).toEqual({
      action: "TRANSACTION_BATCH_IMPORTED",
      entityId: batch.id,
      metadata: { origin: "PASTE", count: 5 }
    });
    expect(
      Object.fromEntries(
        activities
          .filter(({ action }) => action === "TRANSACTION_CREATED")
          .map(({ metadata }) => {
            const value = metadata as { title: string };
            return [value.title, metadata];
          })
      )
    ).toEqual({
      [titles.income]: {
        amount: "90071992547409.99",
        type: "INCOME",
        title: titles.income,
        fromSourceId: null,
        toSourceId: bank.id
      },
      [titles.expense]: {
        amount: "45.25",
        type: "EXPENSE",
        title: titles.expense,
        fromSourceId: card.id,
        toSourceId: null
      },
      [titles.transfer]: {
        amount: "100.00",
        type: "TRANSFER",
        title: titles.transfer,
        fromSourceId: bank.id,
        toSourceId: card.id
      },
      [titles.refund]: {
        amount: "10.25",
        type: "REFUND",
        title: titles.refund,
        fromSourceId: null,
        toSourceId: card.id
      },
      [titles.adjustment]: {
        amount: "2.00",
        type: "ADJUSTMENT",
        title: titles.adjustment,
        fromSourceId: null,
        toSourceId: null
      }
    });
    await expect(
      prisma.activityLog.findFirst({
        where: { userId: context.userA.id, action: "CSV_EXPORTED" },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({ metadata: { rowCount: 6 } });
  }, 60_000);

  it("rejects not-ready, foreign-draft, and foreign-reference selections without partial writes or leakage", async () => {
    authState.userId = fixtures.context.userA.id;
    const [notReady] = await saveReadyExpenseDrafts(1);
    await prisma.transactionDraft.update({
      where: { id: notReady.id },
      data: { status: TransactionDraftStatus.NEEDS_REVIEW }
    });
    const before = await Promise.all([
      prisma.transaction.count({ where: { userId: fixtures.context.userA.id } }),
      prisma.transactionImportBatch.count({ where: { userId: fixtures.context.userA.id } })
    ]);
    await expect(
      importTransactionDrafts({ ids: [notReady.id], idempotencyKey: randomUUID() })
    ).resolves.toEqual({
      ok: false,
      error: "Review every selected draft before saving."
    });

    authState.userId = fixtures.context.userB.id;
    const foreignCaptureKey = randomUUID();
    const foreignSaved = await savePasteDrafts({
      captureKey: foreignCaptureKey,
      rows: [
        expenseDraft(foreignCaptureKey, fixtures.bankBId, {
          title: `Foreign draft ${randomUUID()}`
        })
      ]
    });
    expect(foreignSaved).toMatchObject({ ok: true });
    if (!foreignSaved.ok) throw new Error(foreignSaved.error);
    const foreignDraft = foreignSaved.drafts[0];
    authState.userId = fixtures.context.userA.id;
    const foreignDraftRejection = await importTransactionDrafts({
      ids: [foreignDraft.id],
      idempotencyKey: randomUUID()
    });
    expect(foreignDraftRejection).toEqual({
      ok: false,
      error: "Review every selected draft before saving."
    });
    expect(JSON.stringify(foreignDraftRejection)).not.toContain(
      foreignDraft.title
    );

    const [tampered] = await saveReadyExpenseDrafts(1);
    await prisma.transactionDraft.update({
      where: { id: tampered.id },
      data: {
        status: TransactionDraftStatus.READY,
        categoryId: fixtures.categoryBId
      }
    });
    const rejected = await importTransactionDrafts({
      ids: [tampered.id],
      idempotencyKey: randomUUID()
    });
    expect(rejected).toEqual({
      ok: false,
      error: "Referenced record not found.",
      draftId: tampered.id
    });
    fixtures.foreignNames.forEach((name) =>
      expect(JSON.stringify(rejected)).not.toContain(name)
    );
    await expect(
      Promise.all([
        prisma.transaction.count({ where: { userId: fixtures.context.userA.id } }),
        prisma.transactionImportBatch.count({ where: { userId: fixtures.context.userA.id } })
      ])
    ).resolves.toEqual(before);
    await expect(
      prisma.transactionDraft.findUniqueOrThrow({
        where: { id: foreignDraft.id },
        select: { status: true, importBatchId: true }
      })
    ).resolves.toEqual({
      status: TransactionDraftStatus.READY,
      importBatchId: null
    });
  }, 20_000);

  it("resolves a concurrent replay once and safely rejects key reuse for another selection", async () => {
    authState.userId = fixtures.context.userA.id;
    const drafts = await saveReadyExpenseDrafts(3);
    const firstSelection = drafts.slice(0, 2).map(({ id }) => id);
    const otherSelection = [drafts[2].id];
    const idempotencyKey = randomUUID();

    const [left, right] = await Promise.all([
      importTransactionDrafts({ ids: firstSelection, idempotencyKey }),
      importTransactionDrafts({ ids: [...firstSelection].reverse(), idempotencyKey })
    ]);
    expect(left).toEqual(right);
    expect(left).toMatchObject({ ok: true, importedCount: 2 });
    await expect(
      importTransactionDrafts({ ids: otherSelection, idempotencyKey })
    ).resolves.toEqual({
      ok: false,
      error: "This save key was already used for another selection."
    });
    await expect(
      prisma.transactionImportBatch.count({
        where: { userId: fixtures.context.userA.id, idempotencyKey }
      })
    ).resolves.toBe(1);
    await expect(
      prisma.transactionDraft.findUniqueOrThrow({
        where: { id: otherSelection[0] },
        select: { status: true, importBatchId: true, amountText: true }
      })
    ).resolves.toMatchObject({
      status: TransactionDraftStatus.READY,
      importBatchId: null,
      amountText: drafts[2].amountText
    });
  }, 30_000);

  it("imports and replays the 200-row boundary in one atomic batch", async () => {
    authState.userId = fixtures.context.userA.id;
    const captureKey = randomUUID();
    const expiresAt = new Date("2026-09-03T00:00:00.000Z");
    await prisma.transactionDraft.createMany({
      data: Array.from({ length: 200 }, (_, position) => ({
        userId: fixtures.context.userA.id,
        captureKey,
        position,
        origin: TransactionDraftOrigin.PASTE,
        status: TransactionDraftStatus.READY,
        confidence: 100,
        type: TransactionType.EXPENSE,
        amountText: `${position + 1}.01`,
        currency: "VND",
        title: `Boundary import ${captureKey} ${position}`,
        transactionDateText: "2026-08-20",
        fromMoneySourceId: fixtures.bankAId,
        duplicateFingerprint: `${captureKey}:${position}`,
        expiresAt
      }))
    });
    const drafts = await prisma.transactionDraft.findMany({
      where: { userId: fixtures.context.userA.id, captureKey },
      orderBy: { position: "asc" },
      select: { id: true }
    });
    expect(drafts).toHaveLength(200);
    const ids = drafts.map(({ id }) => id);
    const idempotencyKey = randomUUID();

    const importAndReplayStartedAt = performance.now();
    const first = await importTransactionDrafts({ ids, idempotencyKey });
    const replay = await importTransactionDrafts({
      ids: [...ids].reverse(),
      idempotencyKey
    });
    const importAndReplayElapsedMs =
      performance.now() - importAndReplayStartedAt;

    expect(first).toMatchObject({ ok: true, importedCount: 200 });
    if (!first.ok) throw new Error(first.error);
    expect(replay).toEqual(first);
    expect(
      importAndReplayElapsedMs,
      `Expected the 200-row import and replay to finish in under 60,000 ms; took ${importAndReplayElapsedMs.toFixed(1)} ms.`
    ).toBeLessThan(60_000);
    const batch = await prisma.transactionImportBatch.findUniqueOrThrow({
      where: {
        userId_idempotencyKey: {
          userId: fixtures.context.userA.id,
          idempotencyKey
        }
      }
    });
    const [transactionCount, activityCount, importedDrafts] = await Promise.all([
      prisma.transaction.count({
        where: {
          userId: fixtures.context.userA.id,
          id: { in: first.transactionIds }
        }
      }),
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          entityId: { in: [...first.transactionIds, batch.id] }
        }
      }),
      prisma.transactionDraft.findMany({
        where: { userId: fixtures.context.userA.id, id: { in: ids } },
        select: {
          status: true,
          confidence: true,
          amountText: true,
          title: true,
          duplicateFingerprint: true,
          importedTransactionId: true
        }
      })
    ]);
    expect(transactionCount).toBe(200);
    expect(activityCount).toBe(201);
    expect(importedDrafts).toHaveLength(200);
    expect(
      importedDrafts.every(
        (draft) =>
          draft.status === TransactionDraftStatus.IMPORTED &&
          draft.confidence === null &&
          draft.amountText === null &&
          draft.title === null &&
          draft.duplicateFingerprint === null &&
          draft.importedTransactionId !== null
      )
    ).toBe(true);
  }, 120_000);
});

describe("transaction draft PostgreSQL retention", () => {
  it("deletes 500 then one oldest expired unresolved row without touching future or imported drafts", async () => {
    const userId = fixtures.context.userA.id;
    const retentionPrefix = `retention-${randomUUID()}`;
    const oldest = new Date("1900-01-01T00:00:00.000Z");
    const importedId = `${retentionPrefix}-imported`;
    const futureId = `${retentionPrefix}-future`;
    const expiredData = Array.from({ length: 501 }, (_, position) => ({
      userId,
      captureKey: retentionPrefix,
      position: position + 1_000,
      origin: TransactionDraftOrigin.PASTE,
      status: position % 2 === 0
        ? TransactionDraftStatus.NEEDS_REVIEW
        : TransactionDraftStatus.READY,
      expiresAt: new Date(oldest.getTime() + position * 1_000)
    }));
    await prisma.transactionDraft.createMany({ data: expiredData });
    await prisma.transactionDraft.createMany({
      data: [
        {
          id: futureId,
          userId,
          captureKey: retentionPrefix,
          position: 2_000,
          origin: TransactionDraftOrigin.PASTE,
          status: TransactionDraftStatus.READY,
          expiresAt: new Date("2999-01-01T00:00:00.000Z")
        },
        {
          id: importedId,
          userId,
          captureKey: retentionPrefix,
          position: 2_001,
          origin: TransactionDraftOrigin.PASTE,
          status: TransactionDraftStatus.IMPORTED,
          expiresAt: oldest
        }
      ]
    });

    await expect(
      cleanupExpiredTransactionDrafts(new Date("2026-08-04T00:00:00.000Z"), 500)
    ).resolves.toBe(500);
    await expect(
      prisma.transactionDraft.count({
        where: {
          userId,
          captureKey: retentionPrefix,
          status: { in: [TransactionDraftStatus.NEEDS_REVIEW, TransactionDraftStatus.READY] },
          expiresAt: { lte: new Date("2026-08-04T00:00:00.000Z") }
        }
      })
    ).resolves.toBe(1);
    await expect(
      cleanupExpiredTransactionDrafts(new Date("2026-08-04T00:00:00.000Z"), 1)
    ).resolves.toBe(1);
    await expect(
      prisma.transactionDraft.findMany({
        where: { id: { in: [futureId, importedId] } },
        orderBy: { id: "asc" },
        select: { id: true, status: true }
      })
    ).resolves.toEqual(
      [
        { id: futureId, status: TransactionDraftStatus.READY },
        { id: importedId, status: TransactionDraftStatus.IMPORTED }
      ].sort((left, right) => left.id.localeCompare(right.id))
    );
  }, 20_000);
});
