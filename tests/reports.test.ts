import {
  QualityRating,
  TransactionType
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadIncomeVsExpenseOverTime } from "@/lib/actions/reports";
import {
  getExpenseByCategory,
  getIncomeVsExpenseOverTime,
  getProjectProfitLoss,
  getSpendingBySource,
  getSpendingQualityBreakdown,
  type ReportTransaction
} from "@/lib/calc/reports";

const reportMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  transactionFindMany: vi.fn()
}));

vi.mock("@/lib/auth", () => ({ requireAuth: reportMocks.requireAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: reportMocks.transactionFindMany } }
}));

beforeEach(() => {
  vi.clearAllMocks();
  reportMocks.requireAuth.mockResolvedValue({ id: "report-user" });
  reportMocks.transactionFindMany.mockResolvedValue([]);
});

const categories = [
  { id: "food", name: "Food" },
  { id: "tools", name: "Tools" }
];
const sources = [
  { id: "card", name: "Credit Card" },
  { id: "cash", name: "Cash" }
];

function tx(transaction: Partial<ReportTransaction>): ReportTransaction {
  return {
    amount: 100,
    transactionDate: new Date("2026-07-10T00:00:00.000Z"),
    type: TransactionType.EXPENSE,
    ...transaction
  };
}

function incomeExpenseText(
  rows: ReturnType<typeof getIncomeVsExpenseOverTime>
) {
  return rows.map((row) => ({
    period: row.period,
    income: row.income.toFixed(2),
    expense: row.expense.toFixed(2)
  }));
}

function totalsText<
  T extends { total: { toFixed: (decimalPlaces: number) => string } }
>(rows: T[]) {
  return rows.map(({ total, ...row }) => ({
    ...row,
    total: total.toFixed(2)
  }));
}

describe("getIncomeVsExpenseOverTime", () => {
  it("groups raw income and effective expense by month", () => {
    expect(
      incomeExpenseText(
        getIncomeVsExpenseOverTime(
          [
            tx({
              amount: 1000,
              transactionDate: new Date("2026-07-01T00:00:00.000Z"),
              type: TransactionType.INCOME
            }),
            tx({
              amount: 300,
              transactionDate: new Date("2026-07-02T00:00:00.000Z"),
              type: TransactionType.EXPENSE
            }),
            tx({
              amount: 200,
              transactionDate: new Date("2026-08-02T00:00:00.000Z"),
              type: TransactionType.EXPENSE
            })
          ],
          "month"
        )
      )
    ).toEqual([
      { period: "2026-07", income: "1000.00", expense: "300.00" },
      { period: "2026-08", income: "0.00", expense: "200.00" }
    ]);
  });

  it("subtracts linked refunds from the linked expense period", () => {
    expect(
      incomeExpenseText(
        getIncomeVsExpenseOverTime([
          tx({
            id: "expense-1",
            amount: 300,
            transactionDate: new Date("2026-07-02T00:00:00.000Z")
          }),
          tx({
            amount: 75,
            relatedTransactionId: "expense-1",
            transactionDate: new Date("2026-08-02T00:00:00.000Z"),
            type: TransactionType.REFUND
          })
        ], "month")
      )
    ).toEqual([{ period: "2026-07", income: "0.00", expense: "225.00" }]);
  });

  it("does not subtract unlinked refunds", () => {
    expect(
      incomeExpenseText(
        getIncomeVsExpenseOverTime([
          tx({ id: "expense-1", amount: 300 }),
          tx({ amount: 75, type: TransactionType.REFUND })
        ], "month")
      )
    ).toEqual([{ period: "2026-07", income: "0.00", expense: "300.00" }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getIncomeVsExpenseOverTime([], "day")).toEqual([]);
  });
});

describe("getExpenseByCategory", () => {
  it("groups effective expense by category", () => {
    expect(
      totalsText(
        getExpenseByCategory([
          tx({ amount: 120, categoryId: "food" }),
          tx({ amount: 80, categoryId: "food" }),
          tx({ amount: 50, categoryId: "tools" })
        ], categories)
      )
    ).toEqual([
      { categoryName: "Food", total: "200.00" },
      { categoryName: "Tools", total: "50.00" }
    ]);
  });

  it("subtracts linked refunds from the linked expense category", () => {
    expect(
      totalsText(
        getExpenseByCategory([
          tx({ id: "expense-1", amount: 200, categoryId: "food" }),
          tx({ id: "expense-2", amount: 100, categoryId: "tools" }),
          tx({
            amount: 60,
            relatedTransactionId: "expense-1",
            type: TransactionType.REFUND
          })
        ], categories)
      )
    ).toEqual([
      { categoryName: "Food", total: "140.00" },
      { categoryName: "Tools", total: "100.00" }
    ]);
  });

  it("does not subtract unlinked refunds from any category", () => {
    expect(
      totalsText(
        getExpenseByCategory([
          tx({ id: "expense-1", amount: 200, categoryId: "food" }),
          tx({ amount: 60, type: TransactionType.REFUND })
        ], categories)
      )
    ).toEqual([{ categoryName: "Food", total: "200.00" }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getExpenseByCategory([], categories)).toEqual([]);
  });
});

describe("getSpendingQualityBreakdown", () => {
  it("groups effective rated expense by quality rating", () => {
    expect(
      totalsText(getSpendingQualityBreakdown([
        tx({ amount: 100, qualityRating: QualityRating.A }),
        tx({ amount: 50, qualityRating: QualityRating.A }),
        tx({ amount: 30, qualityRating: QualityRating.C }),
        tx({ amount: 999, qualityRating: null })
      ]))
    ).toEqual([
      { rating: QualityRating.A, count: 2, total: "150.00" },
      { rating: QualityRating.C, count: 1, total: "30.00" }
    ]);
  });

  it("subtracts linked refunds from the linked expense quality rating", () => {
    expect(
      totalsText(getSpendingQualityBreakdown([
        tx({
          id: "expense-1",
          amount: 200,
          qualityRating: QualityRating.B
        }),
        tx({
          id: "expense-2",
          amount: 100,
          qualityRating: QualityRating.D
        }),
        tx({
          amount: 40,
          relatedTransactionId: "expense-1",
          type: TransactionType.REFUND
        })
      ]))
    ).toEqual([
      { rating: QualityRating.B, count: 1, total: "160.00" },
      { rating: QualityRating.D, count: 1, total: "100.00" }
    ]);
  });

  it("does not subtract unlinked refunds from any quality rating", () => {
    expect(
      totalsText(getSpendingQualityBreakdown([
        tx({
          id: "expense-1",
          amount: 200,
          qualityRating: QualityRating.S
        }),
        tx({ amount: 40, type: TransactionType.REFUND })
      ]))
    ).toEqual([{ rating: QualityRating.S, count: 1, total: "200.00" }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getSpendingQualityBreakdown([])).toEqual([]);
  });
});

describe("getSpendingBySource", () => {
  it("groups effective expense by source", () => {
    expect(
      totalsText(
        getSpendingBySource([
          tx({ amount: 100, fromMoneySourceId: "card" }),
          tx({ amount: 75, fromMoneySourceId: "card" }),
          tx({ amount: 25, fromMoneySourceId: "cash" })
        ], sources)
      )
    ).toEqual([
      { sourceName: "Cash", total: "25.00" },
      { sourceName: "Credit Card", total: "175.00" }
    ]);
  });

  it("subtracts linked refunds from the linked expense source", () => {
    expect(
      totalsText(
        getSpendingBySource([
          tx({
            id: "expense-1",
            amount: 200,
            fromMoneySourceId: "card"
          }),
          tx({
            id: "expense-2",
            amount: 100,
            fromMoneySourceId: "cash"
          }),
          tx({
            amount: 50,
            relatedTransactionId: "expense-1",
            type: TransactionType.REFUND
          })
        ], sources)
      )
    ).toEqual([
      { sourceName: "Cash", total: "100.00" },
      { sourceName: "Credit Card", total: "150.00" }
    ]);
  });

  it("does not subtract unlinked refunds from any source", () => {
    expect(
      totalsText(
        getSpendingBySource([
          tx({
            id: "expense-1",
            amount: 200,
            fromMoneySourceId: "card"
          }),
          tx({ amount: 50, type: TransactionType.REFUND })
        ], sources)
      )
    ).toEqual([{ sourceName: "Credit Card", total: "200.00" }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getSpendingBySource([], sources)).toEqual([]);
  });
});

describe("getProjectProfitLoss", () => {
  it("uses linked-refund effective expense without changing raw project-summary semantics", () => {
    const rows = getProjectProfitLoss(
      [
        tx({
          id: "project-expense-fruit",
          amount: "500000.00",
          projectId: "drink-project"
        }),
        tx({
          id: "project-expense-cups",
          amount: "100000.00",
          projectId: "drink-project"
        }),
        tx({
          amount: "900000.00",
          projectId: "drink-project",
          type: TransactionType.INCOME
        }),
        tx({
          amount: "100000.00",
          relatedTransactionId: "project-expense-fruit",
          type: TransactionType.REFUND
        })
      ],
      [{ id: "drink-project", name: "Drink Investment" }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalIncome.toFixed(2)).toBe("900000.00");
    expect(rows[0]?.totalExpense.toFixed(2)).toBe("500000.00");
    expect(rows[0]?.profit.toFixed(2)).toBe("400000.00");
    expect(rows[0]?.roi?.toFixed(2)).toBe("80.00");
  });
});

describe("report transaction date filtering", () => {
  it("queries through the UTC start of the day after an inclusive end date", async () => {
    await loadIncomeVsExpenseOverTime("2026-07-01", "2026-07-30", "day");

    expect(reportMocks.transactionFindMany).toHaveBeenCalledWith({
      where: {
        userId: "report-user",
        transactionDate: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lt: new Date("2026-07-31T00:00:00.000Z")
        }
      },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    });
  });
});
