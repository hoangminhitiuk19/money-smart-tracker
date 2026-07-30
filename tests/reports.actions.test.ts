import { QualityRating, TransactionType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const reportMocks = vi.hoisted(() => ({
  categoryFindMany: vi.fn(),
  financialProjectFindMany: vi.fn(),
  moneySourceFindMany: vi.fn(),
  recurringPaymentFindMany: vi.fn(),
  requireAuth: vi.fn(),
  savingGoalFindMany: vi.fn(),
  transactionFindMany: vi.fn()
}));

vi.mock("@/lib/auth", () => ({ requireAuth: reportMocks.requireAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findMany: reportMocks.categoryFindMany
    },
    financialProject: {
      findMany: reportMocks.financialProjectFindMany
    },
    moneySource: {
      findMany: reportMocks.moneySourceFindMany
    },
    recurringPayment: {
      findMany: reportMocks.recurringPaymentFindMany
    },
    savingGoal: {
      findMany: reportMocks.savingGoalFindMany
    },
    transaction: {
      findMany: reportMocks.transactionFindMany
    }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  reportMocks.requireAuth.mockResolvedValue({ id: "authenticated-user" });
  reportMocks.categoryFindMany.mockResolvedValue([]);
  reportMocks.financialProjectFindMany.mockResolvedValue([]);
  reportMocks.moneySourceFindMany.mockResolvedValue([]);
  reportMocks.recurringPaymentFindMany.mockResolvedValue([]);
  reportMocks.savingGoalFindMany.mockResolvedValue([]);
  reportMocks.transactionFindMany.mockResolvedValue([]);
});

describe("report action filters", () => {
  const combinedFilters = {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    type: TransactionType.EXPENSE,
    categoryId: "category-a",
    qualityRating: QualityRating.A,
    moneySourceId: "source-a",
    projectId: "project-a",
    savingGoalId: "goal-a",
    groupBy: "month" as const
  };
  const combinedTransactionWhere = {
    userId: "authenticated-user",
    type: TransactionType.EXPENSE,
    categoryId: "category-a",
    qualityRating: QualityRating.A,
    projectId: "project-a",
    OR: [
      { fromMoneySourceId: "source-a" },
      { toMoneySourceId: "source-a" },
      { adjustedMoneySourceId: "source-a" }
    ],
    goalContributions: { some: { savingGoalId: "goal-a" } },
    transactionDate: {
      gte: new Date("2026-07-01T00:00:00.000Z"),
      lt: new Date("2026-08-01T00:00:00.000Z")
    }
  };
  const selectedExpense = {
    id: "expense-a",
    amount: "300.00",
    categoryId: "category-a",
    createdAt: new Date("2026-07-10T09:00:01.000Z"),
    fromMoneySourceId: "source-a",
    projectId: "project-a",
    qualityRating: QualityRating.A,
    relatedTransactionId: null,
    transactionDate: new Date("2026-07-10T09:00:00.000Z"),
    type: TransactionType.EXPENSE
  };
  const linkedRefundWhere = {
    userId: "authenticated-user",
    type: TransactionType.REFUND,
    relatedTransactionId: { in: ["expense-a"] }
  };

  it("hydrates only same-user refunds linked to the selected expense population", async () => {
    reportMocks.transactionFindMany
      .mockResolvedValueOnce([selectedExpense])
      .mockResolvedValueOnce([]);

    await loadIncomeVsExpenseOverTime(combinedFilters);

    expect(reportMocks.transactionFindMany).toHaveBeenNthCalledWith(1, {
      where: combinedTransactionWhere,
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    });
    expect(reportMocks.transactionFindMany).toHaveBeenNthCalledWith(2, {
      where: linkedRefundWhere,
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    });
  });

  it("uses selected-expense refund hydration for every effective-expense view", async () => {
    const loaders = [
      loadExpenseByCategory,
      loadSpendingQualityBreakdown,
      loadProjectProfitLoss,
      loadSpendingBySource
    ];

    for (const loader of loaders) {
      reportMocks.transactionFindMany.mockClear();
      reportMocks.transactionFindMany
        .mockResolvedValueOnce([selectedExpense])
        .mockResolvedValueOnce([]);

      await loader(combinedFilters);

      expect(reportMocks.transactionFindMany).toHaveBeenNthCalledWith(1, {
        where: combinedTransactionWhere,
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
      });
      expect(reportMocks.transactionFindMany).toHaveBeenNthCalledWith(2, {
        where: linkedRefundWhere,
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
      });
    }

    expect(reportMocks.financialProjectFindMany).toHaveBeenCalledWith({
      where: { userId: "authenticated-user", id: "project-a" },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });
    expect(reportMocks.moneySourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "authenticated-user",
          id: "source-a"
        })
      })
    );
  });

  it("uses only source and inclusive as-of end for card debt chronology", async () => {
    await loadCreditCardDebtReport(combinedFilters);

    expect(reportMocks.moneySourceFindMany).toHaveBeenCalledWith({
      where: {
        userId: "authenticated-user",
        type: "CREDIT_CARD",
        id: "source-a"
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
    expect(reportMocks.transactionFindMany).toHaveBeenCalledWith({
      where: {
        userId: "authenticated-user",
        transactionDate: {
          lt: new Date("2026-08-01T00:00:00.000Z")
        }
      },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    });
  });

  it("uses the complete owned ledger for configured fee-waiver periods", async () => {
    await loadFeeWaiverReport(combinedFilters);

    expect(reportMocks.moneySourceFindMany).toHaveBeenCalledWith({
      where: {
        userId: "authenticated-user",
        type: "CREDIT_CARD",
        annualFeeWaiverEnabled: true,
        id: "source-a"
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
    expect(reportMocks.transactionFindMany).toHaveBeenCalledWith({
      where: { userId: "authenticated-user" },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    });
  });

  it("applies goal, source, and inclusive dates to goal progress", async () => {
    await loadGoalProgressReport(combinedFilters);

    expect(reportMocks.savingGoalFindMany).toHaveBeenCalledWith({
      where: { userId: "authenticated-user", id: "goal-a" },
      orderBy: [{ status: "asc" }, { deadline: "asc" }, { name: "asc" }],
      include: {
        goalContributions: {
          where: {
            userId: "authenticated-user",
            fromMoneySourceId: "source-a",
            contributionDate: {
              gte: new Date("2026-07-01T00:00:00.000Z"),
              lt: new Date("2026-08-01T00:00:00.000Z")
            }
          }
        }
      }
    });
  });

  it("applies native dimensions to both renewal views", async () => {
    await loadUpcomingRenewalsTotal(combinedFilters);
    await loadRecurringExpensePerMonth(combinedFilters);

    const renewalWhere = {
      userId: "authenticated-user",
      status: "ACTIVE",
      transactionType: TransactionType.EXPENSE,
      categoryId: "category-a",
      qualityRating: QualityRating.A,
      projectId: "project-a",
      OR: [
        { fromMoneySourceId: "source-a" },
        { toMoneySourceId: "source-a" }
      ],
      nextDueDate: {
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lt: new Date("2026-08-01T00:00:00.000Z")
      }
    };

    expect(reportMocks.recurringPaymentFindMany).toHaveBeenNthCalledWith(1, {
      where: renewalWhere,
      orderBy: [{ nextDueDate: "asc" }, { title: "asc" }]
    });
    expect(reportMocks.recurringPaymentFindMany).toHaveBeenNthCalledWith(2, {
      where: renewalWhere,
      orderBy: [{ nextDueDate: "asc" }, { title: "asc" }]
    });
  });

  it("loads only authenticated filter options for the report workbench", async () => {
    await loadReportFilterOptions();

    expect(reportMocks.categoryFindMany).toHaveBeenCalledWith({
      where: { userId: "authenticated-user" },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    });
    expect(reportMocks.moneySourceFindMany).toHaveBeenCalledWith({
      where: { userId: "authenticated-user" },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true }
    });
    expect(reportMocks.financialProjectFindMany).toHaveBeenCalledWith({
      where: { userId: "authenticated-user" },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true }
    });
    expect(reportMocks.savingGoalFindMany).toHaveBeenCalledWith({
      where: { userId: "authenticated-user" },
      orderBy: [{ status: "asc" }, { deadline: "asc" }, { name: "asc" }],
      select: { id: true, name: true }
    });
  });

  it("rejects a caller-supplied userId instead of overriding authentication", async () => {
    await expect(
      loadIncomeVsExpenseOverTime({
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        groupBy: "month",
        userId: "attacker"
      } as never)
    ).rejects.toThrow("Invalid report filters.");

    expect(reportMocks.transactionFindMany).not.toHaveBeenCalled();
  });
});
