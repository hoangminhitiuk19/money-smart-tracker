import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  CategoryType,
  MoneySourceType,
  TransactionDraftOrigin,
  TransactionDraftStatus,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dismissTransactionDrafts,
  importTransactionDrafts,
  listTransactionDrafts,
  savePasteDrafts,
  updateTransactionDraft
} from "@/lib/actions/transaction-drafts";
import { calculateTrackedBalance } from "@/lib/calc/balance";
import {
  calculateCreditCardState,
  calculateFeeWaiverState
} from "@/lib/calc/credit-card";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredTransactionDrafts } from "@/lib/transaction-drafts/retention";
import type { TransactionDraftInput } from "@/lib/transaction-drafts/types";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

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

    await expect(
      updateTransactionDraft(stored[1].id, { duplicateConfirmed: true })
    ).resolves.toMatchObject({ ok: true, draft: { status: "READY" } });
  }, 20_000);
});

describe("transaction draft PostgreSQL import atomicity", () => {
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

  it("imports all five types with exact fields and reconciles the resulting ledgers", async () => {
    authState.userId = fixtures.context.userA.id;
    const suffix = randomUUID();
    const [card, category, originalExpense] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: fixtures.context.userA.id,
          name: `Import card ${suffix}`,
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
          userId: fixtures.context.userA.id,
          name: `Import eligible ${suffix}`,
          type: CategoryType.EXPENSE,
          defaultCountTowardFeeWaiver: true
        }
      }),
      prisma.transaction.create({
        data: {
          userId: fixtures.context.userA.id,
          type: TransactionType.EXPENSE,
          amount: "12.00",
          title: `Import original expense ${suffix}`,
          transactionDate: new Date("2026-08-01T00:00:00.000Z"),
          fromMoneySourceId: fixtures.bankAId
        }
      })
    ]);
    const captureKey = randomUUID();
    const rows: TransactionDraftInput[] = [
      expenseDraft(captureKey, fixtures.bankAId, {
        position: 0,
        type: TransactionType.INCOME,
        amountText: "90071992547409.99",
        title: `Imported exact income ${suffix}`,
        transactionDateText: "2026-08-10",
        fromMoneySourceId: null,
        toMoneySourceId: fixtures.bankAId,
        rawRow: { Amount: "90071992547409.99" }
      }),
      expenseDraft(captureKey, card.id, {
        position: 1,
        amountText: "45.25",
        title: `Imported card expense ${suffix}`,
        transactionDateText: "2026-08-11",
        categoryId: category.id,
        countTowardFeeWaiver: null,
        rawRow: { Amount: "45.25" }
      }),
      expenseDraft(captureKey, fixtures.bankAId, {
        position: 2,
        type: TransactionType.TRANSFER,
        amountText: "100.00",
        title: `Imported card payment ${suffix}`,
        transactionDateText: "2026-08-12",
        toMoneySourceId: card.id,
        rawRow: { Amount: "100.00" }
      }),
      expenseDraft(captureKey, fixtures.bankAId, {
        position: 3,
        type: TransactionType.REFUND,
        amountText: "10.25",
        title: `Imported card refund ${suffix}`,
        transactionDateText: "2026-08-13",
        fromMoneySourceId: null,
        toMoneySourceId: card.id,
        relatedTransactionId: originalExpense.id,
        rawRow: { Amount: "10.25" }
      }),
      expenseDraft(captureKey, fixtures.bankAId, {
        position: 4,
        type: TransactionType.ADJUSTMENT,
        amountText: "5.00",
        title: `Imported card credit adjustment ${suffix}`,
        transactionDateText: "2026-08-14",
        fromMoneySourceId: null,
        adjustedMoneySourceId: card.id,
        adjustmentDirection: AdjustmentDirection.DECREASE,
        adjustmentTarget: AdjustmentTarget.CARD_CREDIT,
        rawRow: { Amount: "5.00" }
      })
    ];
    const saved = await savePasteDrafts({ captureKey, rows });
    expect(saved).toMatchObject({ ok: true });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.drafts.map(({ status }) => status)).toEqual(
      Array(5).fill(TransactionDraftStatus.READY)
    );

    const idempotencyKey = randomUUID();
    const imported = await importTransactionDrafts({
      ids: saved.drafts.map(({ id }) => id),
      idempotencyKey
    });
    expect(imported).toMatchObject({ ok: true, importedCount: 5 });
    if (!imported.ok) throw new Error(imported.error);
    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: imported.transactionIds },
        userId: fixtures.context.userA.id
      },
      orderBy: { transactionDate: "asc" }
    });
    expect(transactions).toHaveLength(5);
    expect(transactions[0]).toMatchObject({
      type: TransactionType.INCOME,
      fromMoneySourceId: null,
      toMoneySourceId: fixtures.bankAId,
      qualityRating: null,
      countTowardFeeWaiver: false
    });
    expect(transactions[0].amount.toFixed(2)).toBe("90071992547409.99");
    expect(transactions[1]).toMatchObject({
      type: TransactionType.EXPENSE,
      fromMoneySourceId: card.id,
      toMoneySourceId: null,
      categoryId: category.id,
      countTowardFeeWaiver: true
    });
    expect(transactions[2]).toMatchObject({
      type: TransactionType.TRANSFER,
      fromMoneySourceId: fixtures.bankAId,
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

    expect(
      calculateTrackedBalance(
        { id: fixtures.bankAId, openingBalance: "0.00" },
        transactions
      ).toFixed(2)
    ).toBe("90071992547309.99");
    const cardState = calculateCreditCardState(card, transactions);
    expect({
      outstandingDebt: cardState.outstandingDebt.toFixed(2),
      cardCredit: cardState.cardCredit.toFixed(2),
      availableCredit: cardState.availableCredit.toFixed(2)
    }).toEqual({
      outstandingDebt: "0.00",
      cardCredit: "30.00",
      availableCredit: "500.00"
    });
    const feeWaiver = calculateFeeWaiverState(card, transactions);
    expect({
      eligibleSpending: feeWaiver.eligibleSpending.toFixed(2),
      remaining: feeWaiver.remaining.toFixed(2)
    }).toEqual({ eligibleSpending: "45.25", remaining: "154.75" });
    const batch = await prisma.transactionImportBatch.findUniqueOrThrow({
      where: {
        userId_idempotencyKey: {
          userId: fixtures.context.userA.id,
          idempotencyKey
        }
      }
    });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          entityId: { in: [...imported.transactionIds, batch.id] }
        }
      })
    ).resolves.toBe(6);
  }, 30_000);

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

    const first = await importTransactionDrafts({ ids, idempotencyKey });
    const replay = await importTransactionDrafts({
      ids: [...ids].reverse(),
      idempotencyKey
    });

    expect(first).toMatchObject({ ok: true, importedCount: 200 });
    if (!first.ok) throw new Error(first.error);
    expect(replay).toEqual(first);
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
