import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  CategoryType,
  MoneySourceType,
  QualityRating,
  RenewalFrequency,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTransaction,
  updateTransaction,
  type TransactionFormInput
} from "@/lib/actions/transactions";
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
    email: "transaction-audit@audit.invalid",
    name: "Transaction audit user"
  }))
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
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
  cardAId: string;
  categoryEligibleId: string;
  categoryExcludedId: string;
  projectAId: string;
  renewalAId: string;
  bankBUserId: string;
  categoryBId: string;
  projectBId: string;
  renewalBId: string;
  expenseBId: string;
};

const contexts: AuditContext[] = [];
let fixtures: Fixtures;

beforeAll(async () => {
  const context = await createAuditContext(`transactions-${randomUUID()}`);
  contexts.push(context);
  const [
    bankA,
    bankB,
    cardA,
    bankBUser,
    categoryEligible,
    categoryExcluded,
    categoryB,
    projectA,
    projectB
  ] = await prisma.$transaction([
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Transaction audit bank A",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Transaction audit bank B",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Transaction audit card",
        type: MoneySourceType.CREDIT_CARD
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userB.id,
        name: "Foreign transaction audit bank",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.category.create({
      data: {
        userId: context.userA.id,
        name: "Eligible audit expense",
        type: CategoryType.EXPENSE,
        defaultCountTowardFeeWaiver: true
      }
    }),
    prisma.category.create({
      data: {
        userId: context.userA.id,
        name: "Excluded audit expense",
        type: CategoryType.EXPENSE,
        defaultCountTowardFeeWaiver: false
      }
    }),
    prisma.category.create({
      data: {
        userId: context.userB.id,
        name: "Foreign audit expense",
        type: CategoryType.EXPENSE,
        defaultCountTowardFeeWaiver: true
      }
    }),
    prisma.financialProject.create({
      data: {
        userId: context.userA.id,
        name: "Transaction audit project"
      }
    }),
    prisma.financialProject.create({
      data: {
        userId: context.userB.id,
        name: "Foreign transaction audit project"
      }
    })
  ]);
  const [renewalA, renewalB, expenseB] = await prisma.$transaction([
    prisma.recurringPayment.create({
      data: {
        userId: context.userA.id,
        title: "Transaction audit renewal",
        amount: "10.00",
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: bankA.id,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-08-01T00:00:00.000Z")
      }
    }),
    prisma.recurringPayment.create({
      data: {
        userId: context.userB.id,
        title: "Foreign transaction audit renewal",
        amount: "10.00",
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: bankBUser.id,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-08-01T00:00:00.000Z")
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userB.id,
        type: TransactionType.EXPENSE,
        amount: "25.00",
        title: "Foreign original expense",
        transactionDate: new Date("2026-07-01T00:00:00.000Z"),
        fromMoneySourceId: bankBUser.id
      }
    })
  ]);

  fixtures = {
    context,
    bankAId: bankA.id,
    bankBId: bankB.id,
    cardAId: cardA.id,
    categoryEligibleId: categoryEligible.id,
    categoryExcludedId: categoryExcluded.id,
    projectAId: projectA.id,
    renewalAId: renewalA.id,
    bankBUserId: bankBUser.id,
    categoryBId: categoryB.id,
    projectBId: projectB.id,
    renewalBId: renewalB.id,
    expenseBId: expenseB.id
  };
  authState.userId = context.userA.id;
}, 20_000);

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
});

async function countsForUser(userId: string) {
  return Promise.all([
    prisma.transaction.count({ where: { userId } }),
    prisma.activityLog.count({ where: { userId } })
  ]);
}

async function expectRejectedWithoutWrites(input: TransactionFormInput) {
  const before = await countsForUser(fixtures.context.userA.id);
  const outcome = await createTransaction(input).then(
    (result) => ({ result }),
    (error: unknown) => ({ error })
  );

  expect(
    "error" in outcome || ("result" in outcome && outcome.result.ok === false)
  ).toBe(true);
  await expect(countsForUser(fixtures.context.userA.id)).resolves.toEqual(before);
}

describe("transaction action persistence", () => {
  it("persists all five types with exact directional, target, relation, and waiver state", async () => {
    authState.userId = fixtures.context.userA.id;
    const before = await countsForUser(fixtures.context.userA.id);
    await expect(
      createTransaction({
        type: TransactionType.INCOME,
        amount: "90071992547409.99",
        title: "Audit exact income",
        transactionDate: "2026-07-10",
        toMoneySourceId: fixtures.bankAId
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      createTransaction({
        type: TransactionType.EXPENSE,
        amount: "125.25",
        title: "Audit card expense",
        transactionDate: "2026-07-11",
        categoryId: fixtures.categoryExcludedId,
        fromMoneySourceId: fixtures.cardAId,
        projectId: fixtures.projectAId,
        recurringPaymentId: fixtures.renewalAId,
        qualityRating: QualityRating.A
      })
    ).resolves.toEqual({ ok: true });
    const originalExpense = await prisma.transaction.findFirstOrThrow({
      where: {
        userId: fixtures.context.userA.id,
        title: "Audit card expense"
      }
    });
    await expect(
      createTransaction({
        type: TransactionType.TRANSFER,
        amount: "75.00",
        title: "Audit transfer",
        transactionDate: "2026-07-12",
        fromMoneySourceId: fixtures.bankAId,
        toMoneySourceId: fixtures.bankBId
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      createTransaction({
        type: TransactionType.REFUND,
        amount: "25.25",
        title: "Audit refund",
        transactionDate: "2026-07-13",
        toMoneySourceId: fixtures.bankAId,
        relatedTransactionId: originalExpense.id
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      createTransaction({
        type: TransactionType.ADJUSTMENT,
        amount: "10.00",
        title: "Audit card adjustment",
        transactionDate: "2026-07-14",
        adjustedMoneySourceId: fixtures.cardAId,
        adjustmentDirection: AdjustmentDirection.INCREASE
      })
    ).resolves.toEqual({ ok: true });

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: fixtures.context.userA.id,
        title: { startsWith: "Audit " }
      },
      orderBy: { transactionDate: "asc" }
    });
    const byTitle = Object.fromEntries(
      transactions.map((transaction) => [transaction.title, transaction])
    );

    expect(byTitle["Audit exact income"]).toMatchObject({
      type: TransactionType.INCOME,
      fromMoneySourceId: null,
      toMoneySourceId: fixtures.bankAId
    });
    expect(byTitle["Audit exact income"].amount.toFixed(2)).toBe(
      "90071992547409.99"
    );
    expect(byTitle["Audit card expense"]).toMatchObject({
      type: TransactionType.EXPENSE,
      fromMoneySourceId: fixtures.cardAId,
      toMoneySourceId: null,
      categoryId: fixtures.categoryExcludedId,
      qualityRating: QualityRating.A,
      countTowardFeeWaiver: false
    });
    expect(byTitle["Audit transfer"]).toMatchObject({
      type: TransactionType.TRANSFER,
      fromMoneySourceId: fixtures.bankAId,
      toMoneySourceId: fixtures.bankBId
    });
    expect(byTitle["Audit refund"]).toMatchObject({
      type: TransactionType.REFUND,
      fromMoneySourceId: null,
      toMoneySourceId: fixtures.bankAId,
      relatedTransactionId: originalExpense.id
    });
    expect(byTitle["Audit card adjustment"]).toMatchObject({
      type: TransactionType.ADJUSTMENT,
      fromMoneySourceId: null,
      toMoneySourceId: null,
      adjustedMoneySourceId: fixtures.cardAId,
      adjustmentDirection: AdjustmentDirection.INCREASE,
      adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT
    });
    await expect(countsForUser(fixtures.context.userA.id)).resolves.toEqual([
      before[0] + 5,
      before[1] + 5
    ]);
  }, 20_000);

  it("rejects every unowned referenced-record position with zero writes", async () => {
    authState.userId = fixtures.context.userA.id;
    const foreignCases: TransactionFormInput[] = [
      {
        type: TransactionType.EXPENSE,
        amount: "10.00",
        title: "Foreign category",
        transactionDate: "2026-07-20",
        fromMoneySourceId: fixtures.bankAId,
        categoryId: fixtures.categoryBId
      },
      {
        type: TransactionType.EXPENSE,
        amount: "10.00",
        title: "Foreign from source",
        transactionDate: "2026-07-20",
        fromMoneySourceId: fixtures.bankBUserId
      },
      {
        type: TransactionType.INCOME,
        amount: "10.00",
        title: "Foreign to source",
        transactionDate: "2026-07-20",
        toMoneySourceId: fixtures.bankBUserId
      },
      {
        type: TransactionType.ADJUSTMENT,
        amount: "10.00",
        title: "Foreign adjusted source",
        transactionDate: "2026-07-20",
        adjustedMoneySourceId: fixtures.bankBUserId,
        adjustmentDirection: AdjustmentDirection.INCREASE
      },
      {
        type: TransactionType.EXPENSE,
        amount: "10.00",
        title: "Foreign project",
        transactionDate: "2026-07-20",
        fromMoneySourceId: fixtures.bankAId,
        projectId: fixtures.projectBId
      },
      {
        type: TransactionType.EXPENSE,
        amount: "10.00",
        title: "Foreign renewal",
        transactionDate: "2026-07-20",
        fromMoneySourceId: fixtures.bankAId,
        recurringPaymentId: fixtures.renewalBId
      },
      {
        type: TransactionType.REFUND,
        amount: "10.00",
        title: "Foreign refund relation",
        transactionDate: "2026-07-20",
        toMoneySourceId: fixtures.bankAId,
        relatedTransactionId: fixtures.expenseBId
      }
    ];

    for (const input of foreignCases) {
      await expectRejectedWithoutWrites(input);
    }
  }, 20_000);

  it("rejects same-user non-EXPENSE refund relations with zero writes", async () => {
    authState.userId = fixtures.context.userA.id;
    const income = await prisma.transaction.create({
      data: {
        userId: fixtures.context.userA.id,
        type: TransactionType.INCOME,
        amount: "15.00",
        title: "Standalone wrong-type relation fixture",
        transactionDate: new Date("2026-07-21T00:00:00.000Z"),
        toMoneySourceId: fixtures.bankAId
      }
    });

    await expectRejectedWithoutWrites({
      type: TransactionType.REFUND,
      amount: "10.00",
      title: "Wrong-type refund relation",
      transactionDate: "2026-07-21",
      toMoneySourceId: fixtures.bankAId,
      relatedTransactionId: income.id
    });
  });

  it("clears stale state on type transition and supports explicit refund unlinking", async () => {
    authState.userId = fixtures.context.userA.id;
    const expense = await prisma.transaction.create({
      data: {
        userId: fixtures.context.userA.id,
        type: TransactionType.EXPENSE,
        amount: "40.00",
        title: "Transition expense",
        description: "Clear this",
        transactionDate: new Date("2026-07-22T00:00:00.000Z"),
        categoryId: fixtures.categoryEligibleId,
        qualityRating: QualityRating.B,
        fromMoneySourceId: fixtures.cardAId,
        projectId: fixtures.projectAId,
        recurringPaymentId: fixtures.renewalAId,
        countTowardFeeWaiver: true
      }
    });
    const refund = await prisma.transaction.create({
      data: {
        userId: fixtures.context.userA.id,
        type: TransactionType.REFUND,
        amount: "5.00",
        title: "Unlink refund",
        description: "Clear refund note",
        transactionDate: new Date("2026-07-23T00:00:00.000Z"),
        categoryId: fixtures.categoryEligibleId,
        toMoneySourceId: fixtures.bankAId,
        projectId: fixtures.projectAId,
        relatedTransactionId: expense.id
      }
    });

    await expect(
      updateTransaction(expense.id, {
        type: TransactionType.INCOME,
        toMoneySourceId: fixtures.bankBId
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      updateTransaction(refund.id, {
        categoryId: null,
        description: null,
        projectId: null,
        relatedTransactionId: null
      })
    ).resolves.toEqual({ ok: true });

    const [updatedIncome, updatedRefund] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: expense.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: refund.id } })
    ]);
    expect(updatedIncome).toMatchObject({
      type: TransactionType.INCOME,
      amount: expense.amount,
      fromMoneySourceId: null,
      toMoneySourceId: fixtures.bankBId,
      qualityRating: null,
      countTowardFeeWaiver: false
    });
    expect(updatedRefund).toMatchObject({
      categoryId: null,
      description: null,
      projectId: null,
      relatedTransactionId: null
    });
  }, 20_000);
});
