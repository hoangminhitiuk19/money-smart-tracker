import { randomUUID } from "node:crypto";
import {
  CategoryType,
  MoneySourceType,
  TransactionDraftOrigin,
  TransactionDraftStatus,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dismissTransactionDrafts,
  listTransactionDrafts,
  savePasteDrafts,
  updateTransactionDraft
} from "@/lib/actions/transaction-drafts";
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
  });

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
  });
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
  });
});
