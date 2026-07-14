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

describe("calculateProjectSummary", () => {
  it("handles a normal profit case", () => {
    expect(
      calculateProjectSummary([
        tx({ amount: 1000, type: TransactionType.INCOME }),
        tx({ amount: 400, type: TransactionType.EXPENSE })
      ])
    ).toEqual({
      totalIncome: 1000,
      totalExpense: 400,
      profit: 600,
      roi: 150
    });
  });

  it("handles a loss case with negative profit", () => {
    expect(
      calculateProjectSummary([
        tx({ amount: 300, type: TransactionType.INCOME }),
        tx({ amount: 500, type: TransactionType.EXPENSE })
      ])
    ).toEqual({
      totalIncome: 300,
      totalExpense: 500,
      profit: -200,
      roi: -40
    });
  });

  it("returns null roi when expense is zero", () => {
    expect(
      calculateProjectSummary([
        tx({ amount: 500, type: TransactionType.INCOME })
      ])
    ).toEqual({
      totalIncome: 500,
      totalExpense: 0,
      profit: 500,
      roi: null
    });
  });

  it("handles zero income with negative profit", () => {
    expect(
      calculateProjectSummary([
        tx({ amount: 250, type: TransactionType.EXPENSE })
      ])
    ).toEqual({
      totalIncome: 0,
      totalExpense: 250,
      profit: -250,
      roi: -100
    });
  });
});
