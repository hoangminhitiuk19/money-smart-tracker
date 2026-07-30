import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  CategoryType,
  ContributionType,
  MoneySourceType,
  QualityRating,
  RenewalFrequency,
  RenewalStatus,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadCreditCardDebtReport,
  loadExpenseByCategory,
  loadFeeWaiverReport,
  loadGoalProgressReport,
  loadIncomeVsExpenseOverTime,
  loadProjectProfitLoss,
  loadRecurringExpensePerMonth,
  loadSpendingBySource,
  loadSpendingQualityBreakdown,
  loadUpcomingRenewalsTotal
} from "@/lib/actions/reports";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import {
  REFERENCE_AMOUNTS,
  REFERENCE_DATES,
  REFERENCE_EXPECTED_LEDGER
} from "@/tests/integration/helpers/reference-ledger";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "reports-audit@audit.invalid",
    name: "Reports audit user"
  }))
}));

let context: AuditContext;
let bankId: string;
let cardId: string;
let categoryAId: string;
let categoryCId: string;
let filterGoalId: string;
let goalId: string;
let ledgerProjectId: string;
let projectId: string;
let waiverCardId: string;

const julyFilters = {
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  groupBy: "month" as const
};

beforeAll(async () => {
  context = await createAuditContext(`reports-${randomUUID()}`);
  authState.userId = context.userA.id;

  const [
    bank,
    card,
    waiverCard,
    categoryA,
    categoryC,
    ledgerProject,
    project,
    goal,
    filterGoal,
    userBSource,
    userBCard,
    userBProject,
    userBGoal
  ] = await prisma.$transaction([
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Reference report bank",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Reference report card",
        type: MoneySourceType.CREDIT_CARD,
        creditLimit: "2000.00",
        initialOutstandingDebt: "300.00",
        initialCardCredit: "500.00"
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Reference waiver card",
        type: MoneySourceType.CREDIT_CARD,
        creditLimit: "1000.00",
        annualFeeWaiverEnabled: true,
        annualFeeWaiverSpendTarget: REFERENCE_AMOUNTS.feeWaiverTarget,
        waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z"),
        waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z")
      }
    }),
    prisma.category.create({
      data: {
        userId: context.userA.id,
        name: "Reference category A",
        type: CategoryType.EXPENSE
      }
    }),
    prisma.category.create({
      data: {
        userId: context.userA.id,
        name: "Reference category C",
        type: CategoryType.EXPENSE
      }
    }),
    prisma.financialProject.create({
      data: {
        userId: context.userA.id,
        name: "Reference ledger project"
      }
    }),
    prisma.financialProject.create({
      data: {
        userId: context.userA.id,
        name: "Reference project profit"
      }
    }),
    prisma.savingGoal.create({
      data: {
        userId: context.userA.id,
        name: "Reference saving goal",
        targetAmount: "1000.00"
      }
    }),
    prisma.savingGoal.create({
      data: {
        userId: context.userA.id,
        name: "Reference expense filter goal",
        targetAmount: "10.00"
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userB.id,
        name: "User B source sentinel",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userB.id,
        name: "User B card sentinel",
        type: MoneySourceType.CREDIT_CARD,
        creditLimit: "9999.00",
        initialOutstandingDebt: "9999.00",
        annualFeeWaiverEnabled: true,
        annualFeeWaiverSpendTarget: "9999.00",
        waiverPeriodStartDate: REFERENCE_DATES.ledgerStart,
        waiverPeriodEndDate: REFERENCE_DATES.periodEndInclusive
      }
    }),
    prisma.financialProject.create({
      data: {
        userId: context.userB.id,
        name: "User B project sentinel"
      }
    }),
    prisma.savingGoal.create({
      data: {
        userId: context.userB.id,
        name: "User B goal sentinel",
        targetAmount: "9999.00"
      }
    })
  ]);

  bankId = bank.id;
  cardId = card.id;
  waiverCardId = waiverCard.id;
  categoryAId = categoryA.id;
  categoryCId = categoryC.id;
  filterGoalId = filterGoal.id;
  goalId = goal.id;
  ledgerProjectId = ledgerProject.id;
  projectId = project.id;

  const [eligibleExpense, projectExpense, waiverExpense] =
    await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.EXPENSE,
        amount: "300.00",
        title: "Reference eligible card expense",
        transactionDate: REFERENCE_DATES.cardExpense,
        createdAt: new Date("2026-07-10T08:59:59.000Z"),
        fromMoneySourceId: cardId,
        countTowardFeeWaiver: true,
        categoryId: categoryAId,
        qualityRating: QualityRating.A,
        projectId: ledgerProjectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.EXPENSE,
        amount: REFERENCE_AMOUNTS.projectExpense,
        title: "Reference raw project expense",
        transactionDate: new Date("2026-07-20T09:00:00.000Z"),
        fromMoneySourceId: bankId,
        projectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.EXPENSE,
        amount: "300.00",
        title: "Reference prior-period waiver expense",
        transactionDate: new Date("2026-06-01T09:00:00.000Z"),
        fromMoneySourceId: waiverCard.id,
        countTowardFeeWaiver: true
      }
    })
  ]);

  await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.INCOME,
        amount: REFERENCE_AMOUNTS.income,
        title: "Reference report income",
        transactionDate: new Date("2026-07-01T00:00:00.000Z"),
        toMoneySourceId: bankId,
        projectId: ledgerProjectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.ADJUSTMENT,
        amount: "100.00",
        title: "Reference debt adjustment",
        transactionDate: new Date("2026-06-10T09:00:00.000Z"),
        createdAt: new Date("2026-06-10T09:00:01.000Z"),
        adjustedMoneySourceId: cardId,
        adjustmentDirection: AdjustmentDirection.INCREASE,
        adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT,
        projectId: ledgerProjectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.TRANSFER,
        amount: "315.00",
        title: "Reference card payment",
        transactionDate: new Date("2026-06-11T09:00:00.000Z"),
        createdAt: new Date("2026-06-11T09:00:01.000Z"),
        fromMoneySourceId: bankId,
        toMoneySourceId: cardId,
        projectId: ledgerProjectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.EXPENSE,
        amount: "140.00",
        title: "Reference excluded card expense",
        transactionDate: new Date("2026-07-11T09:00:00.000Z"),
        createdAt: new Date("2026-07-11T09:00:01.000Z"),
        fromMoneySourceId: cardId,
        countTowardFeeWaiver: false,
        categoryId: categoryCId,
        qualityRating: QualityRating.C,
        projectId: ledgerProjectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.REFUND,
        amount: REFERENCE_AMOUNTS.linkedRefund,
        title: "Reference later cross-destination refund",
        transactionDate: new Date("2026-08-02T09:00:00.000Z"),
        createdAt: new Date("2026-08-02T09:00:01.000Z"),
        toMoneySourceId: bankId,
        relatedTransactionId: eligibleExpense.id
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.ADJUSTMENT,
        amount: "45.00",
        title: "Reference card credit adjustment",
        transactionDate: new Date("2026-07-13T09:00:00.000Z"),
        createdAt: new Date("2026-07-13T09:00:01.000Z"),
        adjustedMoneySourceId: cardId,
        adjustmentDirection: AdjustmentDirection.DECREASE,
        adjustmentTarget: AdjustmentTarget.CARD_CREDIT,
        projectId: ledgerProjectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.INCOME,
        amount: REFERENCE_AMOUNTS.projectIncome,
        title: "Reference project income",
        transactionDate: new Date("2026-07-21T09:00:00.000Z"),
        toMoneySourceId: bankId,
        projectId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.REFUND,
        amount: REFERENCE_AMOUNTS.projectRefund,
        title: "Reference project refund",
        transactionDate: new Date("2026-08-03T09:00:00.000Z"),
        toMoneySourceId: bankId,
        relatedTransactionId: projectExpense.id
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.REFUND,
        amount: REFERENCE_AMOUNTS.linkedRefund,
        title: "Reference waiver-period refund",
        transactionDate: new Date("2026-08-05T09:00:00.000Z"),
        toMoneySourceId: bankId,
        relatedTransactionId: waiverExpense.id
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.REFUND,
        amount: "777.00",
        title: "Unrelated owned refund sentinel",
        transactionDate: new Date("2026-08-06T09:00:00.000Z"),
        toMoneySourceId: bankId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.ADJUSTMENT,
        amount: "999.00",
        title: "Future debt sentinel",
        transactionDate: new Date("2026-08-10T09:00:00.000Z"),
        adjustedMoneySourceId: cardId,
        adjustmentDirection: AdjustmentDirection.INCREASE,
        adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT
      }
    }),
    prisma.goalContribution.create({
      data: {
        userId: context.userA.id,
        savingGoalId: filterGoalId,
        transactionId: eligibleExpense.id,
        amount: "1.00",
        type: ContributionType.CONTRIBUTION,
        contributionDate: new Date("2026-07-10T09:00:00.000Z")
      }
    }),
    prisma.goalContribution.create({
      data: {
        userId: context.userA.id,
        savingGoalId: goalId,
        fromMoneySourceId: bankId,
        amount: "400.00",
        type: ContributionType.CONTRIBUTION,
        contributionDate: new Date("2026-07-15T00:00:00.000Z")
      }
    }),
    prisma.goalContribution.create({
      data: {
        userId: context.userA.id,
        savingGoalId: goalId,
        fromMoneySourceId: bankId,
        amount: "50.00",
        type: ContributionType.WITHDRAWAL,
        contributionDate: new Date("2026-07-16T00:00:00.000Z")
      }
    }),
    prisma.recurringPayment.create({
      data: {
        userId: context.userA.id,
        title: "Reference expense renewal",
        amount: "50.00",
        transactionType: TransactionType.EXPENSE,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-07-25T00:00:00.000Z"),
        reminderDaysBefore: 3,
        status: RenewalStatus.ACTIVE,
        fromMoneySourceId: bankId,
        categoryId: categoryAId,
        projectId: ledgerProjectId,
        qualityRating: QualityRating.A
      }
    }),
    prisma.recurringPayment.create({
      data: {
        userId: context.userA.id,
        title: "Reference income renewal",
        amount: "700.00",
        transactionType: TransactionType.INCOME,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-07-26T00:00:00.000Z"),
        reminderDaysBefore: 3,
        status: RenewalStatus.ACTIVE,
        toMoneySourceId: bankId
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userB.id,
        type: TransactionType.INCOME,
        amount: "9999.00",
        title: "User B income sentinel",
        transactionDate: new Date("2026-07-01T00:00:00.000Z"),
        toMoneySourceId: userBSource.id,
        projectId: userBProject.id
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userB.id,
        type: TransactionType.REFUND,
        amount: "9999.00",
        title: "User B cross-owner refund sentinel",
        transactionDate: new Date("2026-08-02T09:00:00.000Z"),
        toMoneySourceId: userBSource.id,
        relatedTransactionId: eligibleExpense.id
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userB.id,
        type: TransactionType.EXPENSE,
        amount: "9999.00",
        title: "User B expense sentinel",
        transactionDate: new Date("2026-07-11T09:00:00.000Z"),
        fromMoneySourceId: userBCard.id,
        countTowardFeeWaiver: true,
        projectId: userBProject.id
      }
    }),
    prisma.goalContribution.create({
      data: {
        userId: context.userB.id,
        savingGoalId: userBGoal.id,
        fromMoneySourceId: userBSource.id,
        amount: "9999.00",
        type: ContributionType.CONTRIBUTION,
        contributionDate: new Date("2026-07-15T00:00:00.000Z")
      }
    }),
    prisma.recurringPayment.create({
      data: {
        userId: context.userB.id,
        title: "User B renewal sentinel",
        amount: "9999.00",
        transactionType: TransactionType.EXPENSE,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-07-25T00:00:00.000Z"),
        reminderDaysBefore: 3,
        status: RenewalStatus.ACTIVE,
        fromMoneySourceId: userBSource.id
      }
    })
  ]);
}, 20_000);

afterAll(async () => {
  await cleanupAuditContext(context);
  await prisma.$disconnect();
});

describe("report reference reconciliation", () => {
  it("reconciles raw 440.00 to effective 350.00 with exact authenticated income", async () => {
    const filters = { ...julyFilters, projectId: ledgerProjectId };
    const [rows, rawExpense] = await Promise.all([
      loadIncomeVsExpenseOverTime(filters),
      prisma.transaction.aggregate({
        where: {
          userId: context.userA.id,
          projectId: ledgerProjectId,
          type: TransactionType.EXPENSE,
          transactionDate: {
            gte: REFERENCE_DATES.ledgerStart,
            lt: REFERENCE_DATES.nextPeriodStart
          }
        },
        _sum: { amount: true }
      })
    ]);

    expect(rawExpense._sum.amount?.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.rawExpense
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.period).toBe("2026-07");
    expect(rows[0]?.income.toFixed(2)).toBe(REFERENCE_AMOUNTS.income);
    expect(rows[0]?.expense.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.effectiveExpense
    );
  }, 20_000);

  it("attributes effective expense to the original category, quality, and source", async () => {
    const filters = { ...julyFilters, projectId: ledgerProjectId };
    const [categories, qualities, sources] = await Promise.all([
      loadExpenseByCategory(filters),
      loadSpendingQualityBreakdown(filters),
      loadSpendingBySource(filters)
    ]);

    expect(
      categories.map(({ categoryName, total }) => ({
        categoryName,
        total: total.toFixed(2)
      }))
    ).toEqual([
      { categoryName: "Reference category A", total: "210.00" },
      { categoryName: "Reference category C", total: "140.00" }
    ]);
    expect(
      qualities.map(({ rating, count, total }) => ({
        rating,
        count,
        total: total.toFixed(2)
      }))
    ).toEqual([
      { rating: QualityRating.A, count: 1, total: "210.00" },
      { rating: QualityRating.C, count: 1, total: "140.00" }
    ]);
    expect(
      sources.map(({ sourceName, total }) => ({
        sourceName,
        total: total.toFixed(2)
      }))
    ).toEqual([
      { sourceName: "Reference report card", total: "350.00" }
    ]);
  }, 20_000);

  it("hydrates a later cross-destination refund for every combined expense filter", async () => {
    const filters = {
      ...julyFilters,
      type: TransactionType.EXPENSE,
      categoryId: categoryAId,
      qualityRating: QualityRating.A,
      moneySourceId: cardId,
      projectId: ledgerProjectId,
      savingGoalId: filterGoalId
    };
    const [incomeExpense, categories, qualities, sources, projects, rawExpense] =
      await Promise.all([
        loadIncomeVsExpenseOverTime(filters),
        loadExpenseByCategory(filters),
        loadSpendingQualityBreakdown(filters),
        loadSpendingBySource(filters),
        loadProjectProfitLoss(filters),
        prisma.transaction.aggregate({
          where: {
            userId: context.userA.id,
            type: TransactionType.EXPENSE,
            categoryId: categoryAId,
            qualityRating: QualityRating.A,
            fromMoneySourceId: cardId,
            projectId: ledgerProjectId,
            goalContributions: { some: { savingGoalId: filterGoalId } },
            transactionDate: {
              gte: REFERENCE_DATES.ledgerStart,
              lt: REFERENCE_DATES.nextPeriodStart
            }
          },
          _sum: { amount: true }
        })
      ]);

    expect(rawExpense._sum.amount?.toFixed(2)).toBe("300.00");
    expect(incomeExpense[0]?.income.toFixed(2)).toBe("0.00");
    expect(incomeExpense[0]?.expense.toFixed(2)).toBe("210.00");
    expect(categories[0]?.total.toFixed(2)).toBe("210.00");
    expect(qualities[0]?.total.toFixed(2)).toBe("210.00");
    expect(sources[0]?.total.toFixed(2)).toBe("210.00");
    expect(projects[0]?.totalExpense.toFixed(2)).toBe("210.00");
  }, 20_000);

  it("reconciles selected goal progress and project raw-versus-effective cost", async () => {
    const [goals, projects] = await Promise.all([
      loadGoalProgressReport({
        ...julyFilters,
        savingGoalId: goalId,
        moneySourceId: bankId
      }),
      loadProjectProfitLoss({ ...julyFilters, projectId })
    ]);

    expect(goals).toHaveLength(1);
    expect(goals[0]?.goal.name).toBe("Reference saving goal");
    expect(goals[0]?.progress.netContributed.toFixed(2)).toBe("350.00");
    expect(goals[0]?.progress.progressPercent.toFixed(2)).toBe("35.00");
    expect(projects).toHaveLength(1);
    expect(projects[0]?.projectName).toBe("Reference project profit");
    expect(projects[0]?.totalIncome.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.projectIncome
    );
    expect(projects[0]?.totalExpense.toFixed(2)).toBe("500000.00");
    expect(projects[0]?.profit.toFixed(2)).toBe("400000.00");
    expect(projects[0]?.roi?.toFixed(2)).toBe("80.00");
  }, 20_000);

  it("uses debt as-of chronology and the complete configured waiver period", async () => {
    const [debt, waivers] = await Promise.all([
      loadCreditCardDebtReport({
        ...julyFilters,
        type: TransactionType.INCOME,
        categoryId: categoryCId,
        qualityRating: QualityRating.D,
        moneySourceId: cardId,
        projectId,
        savingGoalId: goalId
      }),
      loadFeeWaiverReport({
        ...julyFilters,
        type: TransactionType.INCOME,
        categoryId: categoryCId,
        qualityRating: QualityRating.D,
        moneySourceId: waiverCardId,
        projectId,
        savingGoalId: goalId
      })
    ]);

    expect(debt).toHaveLength(1);
    expect(debt[0]?.source.id).toBe(cardId);
    expect(debt[0]?.state.outstandingDebt.toFixed(2)).toBe(
      REFERENCE_EXPECTED_LEDGER.outstandingDebt
    );
    expect(waivers).toHaveLength(1);
    expect(waivers[0]?.source.id).toBe(waiverCardId);
    expect(waivers[0]?.state.eligibleSpending.toFixed(2)).toBe(
      REFERENCE_EXPECTED_LEDGER.eligibleSpending
    );
  }, 20_000);

  it("applies native filters to upcoming and monthly recurring expense views", async () => {
    const renewalFilters = {
      ...julyFilters,
      type: TransactionType.EXPENSE,
      categoryId: categoryAId,
      qualityRating: QualityRating.A,
      moneySourceId: bankId,
      projectId: ledgerProjectId
    };
    const [upcoming, recurring] = await Promise.all([
      loadUpcomingRenewalsTotal(renewalFilters),
      loadRecurringExpensePerMonth(renewalFilters)
    ]);

    expect(upcoming.count).toBe(1);
    expect(upcoming.total.toFixed(2)).toBe("50.00");
    expect(upcoming.renewals.map(({ title }) => title)).toEqual([
      "Reference expense renewal"
    ]);
    expect(
      recurring.map(({ period, total }) => ({
        period,
        total: total.toFixed(2)
      }))
    ).toEqual([{ period: "2026-07", total: "50.00" }]);
  }, 20_000);
});
