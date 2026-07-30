import { TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateProjectSummary,
  type ProjectSummaryTransaction
} from "@/lib/calc/projects";

function tx(
  transaction: Partial<ProjectSummaryTransaction>
): ProjectSummaryTransaction {
  return {
    amount: 0,
    projectId: "project-1",
    type: TransactionType.INCOME,
    ...transaction
  };
}

function summaryText(result: ReturnType<typeof calculateProjectSummary>) {
  return {
    totalIncome: result.totalIncome.toFixed(2),
    totalExpense: result.totalExpense.toFixed(2),
    profit: result.profit.toFixed(2),
    roi: result.roi?.toDecimalPlaces(8).toString() ?? null
  };
}

describe("calculateProjectSummary", () => {
  it("subtracts decimal cents exactly", () => {
    expect(
      calculateProjectSummary([
        tx({ amount: "0.30", type: TransactionType.INCOME }),
        tx({ amount: "0.10", type: TransactionType.EXPENSE })
      ]).profit.toFixed(2)
    ).toBe("0.20");
  });

  it("handles a normal profit case", () => {
    expect(
      summaryText(
        calculateProjectSummary([
          tx({ amount: 1000, type: TransactionType.INCOME }),
          tx({ amount: 400, type: TransactionType.EXPENSE })
        ])
      )
    ).toEqual({
      totalIncome: "1000.00",
      totalExpense: "400.00",
      profit: "600.00",
      roi: "150"
    });
  });

  it("handles a loss case with negative profit", () => {
    expect(
      summaryText(
        calculateProjectSummary([
          tx({ amount: 300, type: TransactionType.INCOME }),
          tx({ amount: 500, type: TransactionType.EXPENSE })
        ])
      )
    ).toEqual({
      totalIncome: "300.00",
      totalExpense: "500.00",
      profit: "-200.00",
      roi: "-40"
    });
  });

  it("returns null roi when expense is zero", () => {
    expect(
      summaryText(
        calculateProjectSummary([
          tx({ amount: 500, type: TransactionType.INCOME })
        ])
      )
    ).toEqual({
      totalIncome: "500.00",
      totalExpense: "0.00",
      profit: "500.00",
      roi: null
    });
  });

  it("handles zero income with negative profit", () => {
    expect(
      summaryText(
        calculateProjectSummary([
          tx({ amount: 250, type: TransactionType.EXPENSE })
        ])
      )
    ).toEqual({
      totalIncome: "0.00",
      totalExpense: "250.00",
      profit: "-250.00",
      roi: "-100"
    });
  });
});
