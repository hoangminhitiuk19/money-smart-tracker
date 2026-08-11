import { createHash, randomUUID } from "node:crypto";
import {
  InboundEmailReceiptState,
  MoneySourceType,
  TransactionDraftStatus,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dismissTransactionDrafts,
  importTransactionDrafts,
  updateTransactionDraft
} from "@/lib/actions/transaction-drafts";
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

let context: AuditContext;

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

beforeAll(async () => {
  context = await createAuditContext(`email-draft-${randomUUID()}`);
  authState.userId = context.userA.id;
});

afterAll(async () => {
  if (context) await cleanupAuditContext(context);
  await prisma.$disconnect();
});

describe("verified inbound EMAIL drafts", () => {
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
