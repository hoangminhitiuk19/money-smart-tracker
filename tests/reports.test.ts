import {
  QualityRating,
  TransactionType
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getExpenseByCategory,
  getIncomeVsExpenseOverTime,
  getSpendingBySource,
  getSpendingQualityBreakdown,
  type ReportTransaction
} from "@/lib/calc/reports";

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

describe("getIncomeVsExpenseOverTime", () => {
  it("groups raw income and effective expense by month", () => {
    expect(
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
    ).toEqual([
      { period: "2026-07", income: 1000, expense: 300 },
      { period: "2026-08", income: 0, expense: 200 }
    ]);
  });

  it("subtracts linked refunds from the linked expense period", () => {
    expect(
      getIncomeVsExpenseOverTime(
        [
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
        ],
        "month"
      )
    ).toEqual([{ period: "2026-07", income: 0, expense: 225 }]);
  });

  it("does not subtract unlinked refunds", () => {
    expect(
      getIncomeVsExpenseOverTime(
        [
          tx({ id: "expense-1", amount: 300 }),
          tx({ amount: 75, type: TransactionType.REFUND })
        ],
        "month"
      )
    ).toEqual([{ period: "2026-07", income: 0, expense: 300 }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getIncomeVsExpenseOverTime([], "day")).toEqual([]);
  });
});

describe("getExpenseByCategory", () => {
  it("groups effective expense by category", () => {
    expect(
      getExpenseByCategory(
        [
          tx({ amount: 120, categoryId: "food" }),
          tx({ amount: 80, categoryId: "food" }),
          tx({ amount: 50, categoryId: "tools" })
        ],
        categories
      )
    ).toEqual([
      { categoryName: "Food", total: 200 },
      { categoryName: "Tools", total: 50 }
    ]);
  });

  it("subtracts linked refunds from the linked expense category", () => {
    expect(
      getExpenseByCategory(
        [
          tx({ id: "expense-1", amount: 200, categoryId: "food" }),
          tx({ id: "expense-2", amount: 100, categoryId: "tools" }),
          tx({
            amount: 60,
            relatedTransactionId: "expense-1",
            type: TransactionType.REFUND
          })
        ],
        categories
      )
    ).toEqual([
      { categoryName: "Food", total: 140 },
      { categoryName: "Tools", total: 100 }
    ]);
  });

  it("does not subtract unlinked refunds from any category", () => {
    expect(
      getExpenseByCategory(
        [
          tx({ id: "expense-1", amount: 200, categoryId: "food" }),
          tx({ amount: 60, type: TransactionType.REFUND })
        ],
        categories
      )
    ).toEqual([{ categoryName: "Food", total: 200 }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getExpenseByCategory([], categories)).toEqual([]);
  });
});

describe("getSpendingQualityBreakdown", () => {
  it("groups effective rated expense by quality rating", () => {
    expect(
      getSpendingQualityBreakdown([
        tx({ amount: 100, qualityRating: QualityRating.A }),
        tx({ amount: 50, qualityRating: QualityRating.A }),
        tx({ amount: 30, qualityRating: QualityRating.C }),
        tx({ amount: 999, qualityRating: null })
      ])
    ).toEqual([
      { rating: QualityRating.A, count: 2, total: 150 },
      { rating: QualityRating.C, count: 1, total: 30 }
    ]);
  });

  it("subtracts linked refunds from the linked expense quality rating", () => {
    expect(
      getSpendingQualityBreakdown([
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
      ])
    ).toEqual([
      { rating: QualityRating.B, count: 1, total: 160 },
      { rating: QualityRating.D, count: 1, total: 100 }
    ]);
  });

  it("does not subtract unlinked refunds from any quality rating", () => {
    expect(
      getSpendingQualityBreakdown([
        tx({
          id: "expense-1",
          amount: 200,
          qualityRating: QualityRating.S
        }),
        tx({ amount: 40, type: TransactionType.REFUND })
      ])
    ).toEqual([{ rating: QualityRating.S, count: 1, total: 200 }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getSpendingQualityBreakdown([])).toEqual([]);
  });
});

describe("getSpendingBySource", () => {
  it("groups effective expense by source", () => {
    expect(
      getSpendingBySource(
        [
          tx({ amount: 100, fromMoneySourceId: "card" }),
          tx({ amount: 75, fromMoneySourceId: "card" }),
          tx({ amount: 25, fromMoneySourceId: "cash" })
        ],
        sources
      )
    ).toEqual([
      { sourceName: "Cash", total: 25 },
      { sourceName: "Credit Card", total: 175 }
    ]);
  });

  it("subtracts linked refunds from the linked expense source", () => {
    expect(
      getSpendingBySource(
        [
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
        ],
        sources
      )
    ).toEqual([
      { sourceName: "Cash", total: 100 },
      { sourceName: "Credit Card", total: 150 }
    ]);
  });

  it("does not subtract unlinked refunds from any source", () => {
    expect(
      getSpendingBySource(
        [
          tx({
            id: "expense-1",
            amount: 200,
            fromMoneySourceId: "card"
          }),
          tx({ amount: 50, type: TransactionType.REFUND })
        ],
        sources
      )
    ).toEqual([{ sourceName: "Credit Card", total: 200 }]);
  });

  it("returns an empty array for no transactions", () => {
    expect(getSpendingBySource([], sources)).toEqual([]);
  });
});
