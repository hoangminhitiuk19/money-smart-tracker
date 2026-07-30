import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  CategoryType,
  ContributionType,
  MoneySourceType,
  QualityRating,
  RenewalFrequency,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory
} from "@/lib/actions/categories";
import {
  createContribution,
  deleteContribution,
  listContributionsForGoal,
  updateContribution
} from "@/lib/actions/goal-contributions";
import {
  createGoal,
  deleteGoal,
  getGoal,
  listGoals,
  updateGoal
} from "@/lib/actions/goals";
import {
  createMoneySource,
  deleteMoneySource,
  getMoneySource,
  listMoneySources,
  updateMoneySource
} from "@/lib/actions/money-sources";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject
} from "@/lib/actions/projects";
import {
  cancelRenewal,
  createRenewal,
  deleteRenewal,
  getRenewal,
  listRenewals,
  markRenewalAsPaid,
  pauseRenewal,
  resumeRenewal,
  skipRenewalCycle,
  updateRenewal
} from "@/lib/actions/renewals";
import {
  loadCreditCardDebtReport,
  loadExpenseByCategory,
  loadFeeWaiverReport,
  loadGoalProgressReport,
  loadIncomeVsExpenseOverTime,
  loadProjectProfitLoss,
  loadRecurringExpensePerMonth,
  loadReportFilterOptions,
  loadSpendingBySource,
  loadSpendingQualityBreakdown,
  loadUpcomingRenewalsTotal
} from "@/lib/actions/reports";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  searchTransactions,
  updateTransaction
} from "@/lib/actions/transactions";
import { getDashboardData } from "@/lib/actions/dashboard";
import { prisma } from "@/lib/prisma";
import { GET as exportTransactions } from "@/app/api/export/transactions/route";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "ownership-audit@audit.invalid",
    name: "Ownership audit user"
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
  prefix: string;
  categoryAId: string;
  bankAId: string;
  projectAId: string;
  transactionAId: string;
  goalAId: string;
  contributionAId: string;
  renewalAId: string;
  categoryBId: string;
  bankBId: string;
  bankB2Id: string;
  projectBId: string;
  goalBId: string;
  transactionBId: string;
};

const contexts: AuditContext[] = [];
let fixtures: Fixtures;

async function expectOk(result: Promise<{ ok: boolean; error?: string }>) {
  await expect(result).resolves.toEqual({ ok: true });
}

async function findOwnedIds(
  context: AuditContext,
  prefix: string
): Promise<Omit<Fixtures, "context" | "prefix">> {
  const [
    categoryA,
    bankA,
    projectA,
    transactionA,
    goalA,
    contributionA,
    renewalA,
    categoryB,
    bankB,
    bankB2,
    projectB,
    goalB,
    transactionB
  ] = await Promise.all([
    prisma.category.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} category A` }
    }),
    prisma.moneySource.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} bank A` }
    }),
    prisma.financialProject.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} project A` }
    }),
    prisma.transaction.findFirstOrThrow({
      where: { userId: context.userA.id, title: `${prefix} expense A` }
    }),
    prisma.savingGoal.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} goal A` }
    }),
    prisma.goalContribution.findFirstOrThrow({
      where: { userId: context.userA.id, note: `${prefix} contribution A` }
    }),
    prisma.recurringPayment.findFirstOrThrow({
      where: { userId: context.userA.id, title: `${prefix} renewal A` }
    }),
    prisma.category.findFirstOrThrow({
      where: { userId: context.userB.id, name: `${prefix} category B` }
    }),
    prisma.moneySource.findFirstOrThrow({
      where: { userId: context.userB.id, name: `${prefix} bank B` }
    }),
    prisma.moneySource.findFirstOrThrow({
      where: { userId: context.userB.id, name: `${prefix} bank B2` }
    }),
    prisma.financialProject.findFirstOrThrow({
      where: { userId: context.userB.id, name: `${prefix} project B` }
    }),
    prisma.savingGoal.findFirstOrThrow({
      where: { userId: context.userB.id, name: `${prefix} goal B` }
    }),
    prisma.transaction.findFirstOrThrow({
      where: { userId: context.userB.id, title: `${prefix} income B` }
    })
  ]);

  return {
    categoryAId: categoryA.id,
    bankAId: bankA.id,
    projectAId: projectA.id,
    transactionAId: transactionA.id,
    goalAId: goalA.id,
    contributionAId: contributionA.id,
    renewalAId: renewalA.id,
    categoryBId: categoryB.id,
    bankBId: bankB.id,
    bankB2Id: bankB2.id,
    projectBId: projectB.id,
    goalBId: goalB.id,
    transactionBId: transactionB.id
  };
}

beforeAll(async () => {
  const context = await createAuditContext(`ownership-${randomUUID()}`);
  contexts.push(context);
  const prefix = `ownership-${randomUUID()}`;

  authState.userId = context.userA.id;
  await expectOk(
    createCategory({
      name: `${prefix} category A`,
      type: CategoryType.EXPENSE,
      defaultQualityRating: QualityRating.A
    })
  );
  await expectOk(
    createMoneySource({
      name: `${prefix} bank A`,
      type: MoneySourceType.BANK_ACCOUNT,
      openingBalance: "100.00"
    })
  );
  await expectOk(createProject({ name: `${prefix} project A` }));
  await expectOk(
    createGoal({ name: `${prefix} goal A`, targetAmount: "500.00" })
  );
  const [categoryA, bankA, projectA, goalA] = await Promise.all([
    prisma.category.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} category A` }
    }),
    prisma.moneySource.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} bank A` }
    }),
    prisma.financialProject.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} project A` }
    }),
    prisma.savingGoal.findFirstOrThrow({
      where: { userId: context.userA.id, name: `${prefix} goal A` }
    })
  ]);
  await expectOk(
    createTransaction({
      type: TransactionType.EXPENSE,
      amount: "25.00",
      title: `${prefix} expense A`,
      transactionDate: "2026-07-10",
      categoryId: categoryA.id,
      qualityRating: QualityRating.A,
      fromMoneySourceId: bankA.id,
      projectId: projectA.id
    })
  );
  await expectOk(
    createContribution({
      savingGoalId: goalA.id,
      fromMoneySourceId: bankA.id,
      amount: "10.00",
      type: ContributionType.CONTRIBUTION,
      note: `${prefix} contribution A`,
      contributionDate: "2026-07-11"
    })
  );
  await expectOk(
    createRenewal({
      title: `${prefix} renewal A`,
      amount: "5.00",
      transactionType: TransactionType.EXPENSE,
      fromMoneySourceId: bankA.id,
      categoryId: categoryA.id,
      projectId: projectA.id,
      frequency: RenewalFrequency.MONTHLY,
      nextDueDate: "2026-08-02"
    })
  );

  authState.userId = context.userB.id;
  await expectOk(
    createCategory({
      name: `${prefix} category B`,
      type: CategoryType.EXPENSE
    })
  );
  await expectOk(
    createMoneySource({
      name: `${prefix} bank B`,
      type: MoneySourceType.BANK_ACCOUNT
    })
  );
  await expectOk(
    createMoneySource({
      name: `${prefix} bank B2`,
      type: MoneySourceType.BANK_ACCOUNT
    })
  );
  await expectOk(createProject({ name: `${prefix} project B` }));
  await expectOk(
    createGoal({ name: `${prefix} goal B`, targetAmount: "500.00" })
  );
  const bankB = await prisma.moneySource.findFirstOrThrow({
    where: { userId: context.userB.id, name: `${prefix} bank B` }
  });
  await expectOk(
    createTransaction({
      type: TransactionType.INCOME,
      amount: "40.00",
      title: `${prefix} income B`,
      transactionDate: "2026-07-10",
      toMoneySourceId: bankB.id
    })
  );

  fixtures = {
    context,
    prefix,
    ...(await findOwnedIds(context, prefix))
  };
}, 30_000);

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
}, 20_000);

async function snapshotUserState(userId: string) {
  const [
    categories,
    moneySources,
    projects,
    transactions,
    goals,
    contributions,
    renewals,
    activity
  ] = await Promise.all([
    prisma.category.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.moneySource.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.financialProject.findMany({
      where: { userId },
      orderBy: { id: "asc" }
    }),
    prisma.transaction.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.savingGoal.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.goalContribution.findMany({
      where: { userId },
      orderBy: { id: "asc" }
    }),
    prisma.recurringPayment.findMany({
      where: { userId },
      orderBy: { id: "asc" }
    }),
    prisma.activityLog.findMany({ where: { userId }, orderBy: { id: "asc" } })
  ]);

  return JSON.parse(
    JSON.stringify({
      categories,
      moneySources,
      projects,
      transactions,
      goals,
      contributions,
      renewals,
      activity
    })
  );
}

async function expectSafeFailure(attempt: () => Promise<unknown>) {
  const outcome = await attempt().then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
  const message =
    "error" in outcome
      ? outcome.error instanceof Error
        ? outcome.error.message
        : String(outcome.error)
      : typeof outcome.value === "object" &&
          outcome.value !== null &&
          "error" in outcome.value
        ? String(outcome.value.error)
        : "";

  expect(message).toMatch(/not found/i);
  expect(message).not.toContain(fixtures.prefix);
}

describe("two-user ownership boundary", () => {
  it("rejects User B get, update, and delete attempts on every User A root", async () => {
    authState.userId = fixtures.context.userB.id;
    const before = await snapshotUserState(fixtures.context.userA.id);
    const attempts = [
      () => getCategory(fixtures.categoryAId),
      () =>
        updateCategory(fixtures.categoryAId, {
          name: `${fixtures.prefix} stolen category`,
          type: CategoryType.EXPENSE
        }),
      () => deleteCategory(fixtures.categoryAId),
      () => getMoneySource(fixtures.bankAId),
      () => updateMoneySource(fixtures.bankAId, { name: "Stolen source" }),
      () => deleteMoneySource(fixtures.bankAId),
      () => getProject(fixtures.projectAId),
      () => updateProject(fixtures.projectAId, { name: "Stolen project" }),
      () => deleteProject(fixtures.projectAId),
      () => getTransaction(fixtures.transactionAId),
      () =>
        updateTransaction(fixtures.transactionAId, {
          title: "Stolen transaction"
        }),
      () => deleteTransaction(fixtures.transactionAId),
      () => getGoal(fixtures.goalAId),
      () => updateGoal(fixtures.goalAId, { name: "Stolen goal" }),
      () => deleteGoal(fixtures.goalAId),
      () =>
        updateContribution(fixtures.contributionAId, {
          amount: "11.00"
        }),
      () => deleteContribution(fixtures.contributionAId),
      () => listContributionsForGoal(fixtures.goalAId),
      () => getRenewal(fixtures.renewalAId),
      () => updateRenewal(fixtures.renewalAId, { title: "Stolen renewal" }),
      () => deleteRenewal(fixtures.renewalAId)
    ];

    for (const attempt of attempts) {
      await expectSafeFailure(attempt);
    }

    await expect(snapshotUserState(fixtures.context.userA.id)).resolves.toEqual(
      before
    );
  }, 30_000);

  it("rejects every User A foreign-key position while preserving the exact ledger", async () => {
    authState.userId = fixtures.context.userB.id;
    const before = await snapshotUserState(fixtures.context.userA.id);
    const transactionAttempts = [
      () =>
        createTransaction({
          type: TransactionType.EXPENSE,
          amount: "1.00",
          title: "Foreign category",
          transactionDate: "2026-07-20",
          fromMoneySourceId: fixtures.bankBId,
          categoryId: fixtures.categoryAId
        }),
      () =>
        createTransaction({
          type: TransactionType.EXPENSE,
          amount: "1.00",
          title: "Foreign from source",
          transactionDate: "2026-07-20",
          fromMoneySourceId: fixtures.bankAId
        }),
      () =>
        createTransaction({
          type: TransactionType.INCOME,
          amount: "1.00",
          title: "Foreign to source",
          transactionDate: "2026-07-20",
          toMoneySourceId: fixtures.bankAId
        }),
      () =>
        createTransaction({
          type: TransactionType.ADJUSTMENT,
          amount: "1.00",
          title: "Foreign adjusted source",
          transactionDate: "2026-07-20",
          adjustedMoneySourceId: fixtures.bankAId,
          adjustmentDirection: AdjustmentDirection.INCREASE
        }),
      () =>
        createTransaction({
          type: TransactionType.EXPENSE,
          amount: "1.00",
          title: "Foreign project",
          transactionDate: "2026-07-20",
          fromMoneySourceId: fixtures.bankBId,
          projectId: fixtures.projectAId
        }),
      () =>
        createTransaction({
          type: TransactionType.EXPENSE,
          amount: "1.00",
          title: "Foreign renewal",
          transactionDate: "2026-07-20",
          fromMoneySourceId: fixtures.bankBId,
          recurringPaymentId: fixtures.renewalAId
        }),
      () =>
        createTransaction({
          type: TransactionType.REFUND,
          amount: "1.00",
          title: "Foreign related transaction",
          transactionDate: "2026-07-20",
          toMoneySourceId: fixtures.bankBId,
          relatedTransactionId: fixtures.transactionAId
        })
    ];
    const contributionAttempts = [
      () =>
        createContribution({
          savingGoalId: fixtures.goalAId,
          amount: "1.00",
          type: ContributionType.CONTRIBUTION,
          contributionDate: "2026-07-20"
        }),
      () =>
        createContribution({
          savingGoalId: fixtures.goalBId,
          transactionId: fixtures.transactionAId,
          amount: "1.00",
          type: ContributionType.CONTRIBUTION,
          contributionDate: "2026-07-20"
        }),
      () =>
        createContribution({
          savingGoalId: fixtures.goalBId,
          fromMoneySourceId: fixtures.bankAId,
          amount: "1.00",
          type: ContributionType.CONTRIBUTION,
          contributionDate: "2026-07-20"
        })
    ];
    const renewalAttempts = [
      () =>
        createRenewal({
          title: "Foreign renewal from source",
          amount: "1.00",
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: fixtures.bankAId,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: "2026-08-02"
        }),
      () =>
        createRenewal({
          title: "Foreign renewal to source",
          amount: "1.00",
          transactionType: TransactionType.INCOME,
          toMoneySourceId: fixtures.bankAId,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: "2026-08-02"
        }),
      () =>
        createRenewal({
          title: "Foreign renewal category",
          amount: "1.00",
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: fixtures.bankBId,
          categoryId: fixtures.categoryAId,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: "2026-08-02"
        }),
      () =>
        createRenewal({
          title: "Foreign renewal project",
          amount: "1.00",
          transactionType: TransactionType.EXPENSE,
          fromMoneySourceId: fixtures.bankBId,
          projectId: fixtures.projectAId,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: "2026-08-02"
        })
    ];

    for (const attempt of [
      ...transactionAttempts,
      ...contributionAttempts,
      ...renewalAttempts
    ]) {
      await expectSafeFailure(attempt);
    }

    await expect(snapshotUserState(fixtures.context.userA.id)).resolves.toEqual(
      before
    );
  }, 30_000);

  it("keeps User A out of User B list, search, dashboard, report, renewal, and export paths", async () => {
    authState.userId = fixtures.context.userB.id;
    const before = await snapshotUserState(fixtures.context.userA.id);

    for (const attempt of [
      () => markRenewalAsPaid(fixtures.renewalAId),
      () => skipRenewalCycle(fixtures.renewalAId),
      () => pauseRenewal(fixtures.renewalAId),
      () => resumeRenewal(fixtures.renewalAId),
      () => cancelRenewal(fixtures.renewalAId)
    ]) {
      await expectSafeFailure(attempt);
    }

    const scopedResults = await Promise.all([
      listCategories(),
      listMoneySources(),
      listProjects(),
      listGoals(),
      listRenewals(),
      searchTransactions({ q: fixtures.prefix }),
      listTransactions({ categoryId: fixtures.categoryAId }),
      getDashboardData("2026-07-01", "2026-07-31"),
      loadReportFilterOptions(),
      loadIncomeVsExpenseOverTime({ categoryId: fixtures.categoryAId }),
      loadExpenseByCategory({ categoryId: fixtures.categoryAId }),
      loadSpendingQualityBreakdown({ projectId: fixtures.projectAId }),
      loadGoalProgressReport({ savingGoalId: fixtures.goalAId }),
      loadProjectProfitLoss({ projectId: fixtures.projectAId }),
      loadSpendingBySource({ moneySourceId: fixtures.bankAId }),
      loadCreditCardDebtReport({ moneySourceId: fixtures.bankAId }),
      loadFeeWaiverReport({ moneySourceId: fixtures.bankAId }),
      loadUpcomingRenewalsTotal({ projectId: fixtures.projectAId }),
      loadRecurringExpensePerMonth({ projectId: fixtures.projectAId })
    ]);
    const serialized = JSON.stringify(scopedResults);

    expect(serialized).not.toContain(fixtures.categoryAId);
    expect(serialized).not.toContain(fixtures.bankAId);
    expect(serialized).not.toContain(fixtures.projectAId);
    expect(serialized).not.toContain(fixtures.transactionAId);
    expect(serialized).not.toContain(fixtures.goalAId);
    expect(serialized).not.toContain(fixtures.contributionAId);
    expect(serialized).not.toContain(fixtures.renewalAId);
    expect(serialized).not.toContain(`${fixtures.prefix} expense A`);

    const response = await exportTransactions(
      new Request(
        `http://localhost/api/export/transactions?userId=${fixtures.context.userA.id}`
      )
    );
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(csv).toContain(`${fixtures.prefix} income B`);
    expect(csv).not.toContain(`${fixtures.prefix} expense A`);
    await expect(
      prisma.activityLog.findFirst({
        where: {
          userId: fixtures.context.userB.id,
          action: "CSV_EXPORTED"
        },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({ rowCount: 1 })
    });

    await expect(snapshotUserState(fixtures.context.userA.id)).resolves.toEqual(
      before
    );
  }, 30_000);
});
