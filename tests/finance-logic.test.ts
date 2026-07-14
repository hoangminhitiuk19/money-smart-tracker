import { describe, expect, it } from "vitest";
import {
  calculateTrackedBalance,
  type BalanceSource,
  type BalanceTransaction
} from "@/lib/calc/balance";
import {
  calculateCreditCardState,
  calculateFeeWaiverState,
  type CreditCardSource,
  type CreditCardTransaction
} from "@/lib/calc/credit-card";
import {
  calculateGoalProgress,
  overContributionError,
  validateContributionAgainstTransaction,
  type GoalProgressContribution
} from "@/lib/calc/goals";
import {
  calculateProjectSummary,
  type ProjectSummaryTransaction
} from "@/lib/calc/projects";
import { calculateNextDueDate } from "@/lib/calc/renewals";
import {
  adjustmentDirectionEffect,
  getCountTowardFeeWaiverDefault,
  validateTransactionFields,
  type FeeWaiverSource,
  type TransactionValidationInput
} from "@/lib/calc/transactions";
import {
  calculateEstimatedNetPosition,
  calculateNetSavings,
  type DashboardMoneySource,
  type DashboardTransaction
} from "@/lib/calc/dashboard";
import {
  getSpendingQualityBreakdown,
  type ReportTransaction
} from "@/lib/calc/reports";
import { ownershipGuard } from "@/lib/calc/ownership";

const bankSource: BalanceSource = {
  id: "bank-1",
  openingBalance: 1000
};

function balanceTx(
  transaction: Partial<BalanceTransaction>
): BalanceTransaction {
  return {
    amount: 100,
    type: "EXPENSE",
    ...transaction
  };
}

function cardSource(source: Partial<CreditCardSource> = {}): CreditCardSource {
  return {
    id: "card-1",
    creditLimit: 1000,
    initialCardCredit: 0,
    initialOutstandingDebt: 0,
    ...source
  };
}

function cardTx(
  transaction: Partial<CreditCardTransaction>
): CreditCardTransaction {
  return {
    amount: 100,
    transactionDate: new Date("2026-07-10T00:00:00.000Z"),
    type: "EXPENSE",
    ...transaction
  };
}

function goalContribution(
  contribution: Partial<GoalProgressContribution>
): GoalProgressContribution {
  return {
    amount: 100,
    type: "CONTRIBUTION",
    ...contribution
  };
}

function projectTx(
  transaction: Partial<ProjectSummaryTransaction>
): ProjectSummaryTransaction {
  return {
    amount: 100,
    type: "EXPENSE",
    ...transaction
  };
}

function validation(
  transaction: Partial<TransactionValidationInput>
): TransactionValidationInput {
  return {
    amount: 100,
    type: "EXPENSE",
    ...transaction
  };
}

function dashboardTx(
  transaction: Partial<DashboardTransaction>
): DashboardTransaction {
  return {
    amount: 100,
    transactionDate: new Date("2026-07-10T00:00:00.000Z"),
    type: "EXPENSE",
    ...transaction
  };
}

function dashboardSource(
  source: Partial<DashboardMoneySource>
): DashboardMoneySource {
  return {
    id: "bank-1",
    openingBalance: 0,
    type: "BANK_ACCOUNT",
    ...source
  };
}

function reportTx(transaction: Partial<ReportTransaction>): ReportTransaction {
  return {
    amount: 100,
    transactionDate: new Date("2026-07-10T00:00:00.000Z"),
    type: "EXPENSE",
    ...transaction
  };
}

describe("finance logic requirements", () => {
  it("calculateTrackedBalance - income increases balance", () => {
    const transactions = [
      balanceTx({
        amount: 250,
        toMoneySourceId: bankSource.id,
        type: "INCOME"
      })
    ];

    expect(calculateTrackedBalance(bankSource, transactions)).toBe(1250);
  });

  it("calculateTrackedBalance - expense decreases balance", () => {
    const transactions = [
      balanceTx({
        amount: 175,
        fromMoneySourceId: bankSource.id,
        type: "EXPENSE"
      })
    ];

    expect(calculateTrackedBalance(bankSource, transactions)).toBe(825);
  });

  it("calculateTrackedBalance - REFUND increases balance", () => {
    const transactions = [
      balanceTx({
        amount: 60,
        toMoneySourceId: bankSource.id,
        type: "REFUND"
      })
    ];

    expect(calculateTrackedBalance(bankSource, transactions)).toBe(1060);
  });

  it("calculateTrackedBalance - transfer in/out correct", () => {
    const transactions = [
      balanceTx({
        amount: 300,
        toMoneySourceId: bankSource.id,
        type: "TRANSFER"
      }),
      balanceTx({
        amount: 125,
        fromMoneySourceId: bankSource.id,
        type: "TRANSFER"
      })
    ];

    expect(calculateTrackedBalance(bankSource, transactions)).toBe(1175);
  });

  it("calculateTrackedBalance - adjustment INCREASE and DECREASE", () => {
    const transactions = [
      balanceTx({
        adjustedMoneySourceId: bankSource.id,
        adjustmentDirection: "INCREASE",
        amount: 90,
        type: "ADJUSTMENT"
      }),
      balanceTx({
        adjustedMoneySourceId: bankSource.id,
        adjustmentDirection: "DECREASE",
        amount: 35,
        type: "ADJUSTMENT"
      })
    ];

    expect(calculateTrackedBalance(bankSource, transactions)).toBe(1055);
  });

  it("calculateCreditCardState - expense with no card credit increases debt", () => {
    const transactions = [
      cardTx({
        amount: 120,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(calculateCreditCardState(cardSource(), transactions)).toEqual({
      availableCredit: 880,
      cardCredit: 0,
      outstandingDebt: 120
    });
  });

  it("calculateCreditCardState - expense fully covered by card credit, debt unchanged", () => {
    const transactions = [
      cardTx({
        amount: 80,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(
      calculateCreditCardState(cardSource({ initialCardCredit: 200 }), transactions)
    ).toEqual({
      availableCredit: 1000,
      cardCredit: 120,
      outstandingDebt: 0
    });
  });

  it("calculateCreditCardState - expense partially covered by card credit", () => {
    const transactions = [
      cardTx({
        amount: 250,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(
      calculateCreditCardState(cardSource({ initialCardCredit: 100 }), transactions)
    ).toEqual({
      availableCredit: 850,
      cardCredit: 0,
      outstandingDebt: 150
    });
  });

  it("calculateCreditCardState - payment reduces debt", () => {
    const transactions = [
      cardTx({
        amount: 175,
        toMoneySourceId: "card-1",
        type: "TRANSFER"
      })
    ];

    expect(
      calculateCreditCardState(
        cardSource({ initialOutstandingDebt: 500 }),
        transactions
      )
    ).toEqual({
      availableCredit: 675,
      cardCredit: 0,
      outstandingDebt: 325
    });
  });

  it("calculateCreditCardState - payment overflow -> card credit", () => {
    const transactions = [
      cardTx({
        amount: 300,
        toMoneySourceId: "card-1",
        type: "TRANSFER"
      })
    ];

    expect(
      calculateCreditCardState(
        cardSource({ initialOutstandingDebt: 125 }),
        transactions
      )
    ).toEqual({
      availableCredit: 1000,
      cardCredit: 175,
      outstandingDebt: 0
    });
  });

  it("calculateCreditCardState - refund reduces debt (Case A)", () => {
    const transactions = [
      cardTx({
        amount: 90,
        toMoneySourceId: "card-1",
        type: "REFUND"
      })
    ];

    expect(
      calculateCreditCardState(
        cardSource({ initialOutstandingDebt: 300 }),
        transactions
      )
    ).toEqual({
      availableCredit: 790,
      cardCredit: 0,
      outstandingDebt: 210
    });
  });

  it("calculateCreditCardState - refund overflows debt (Case B)", () => {
    const transactions = [
      cardTx({
        amount: 240,
        toMoneySourceId: "card-1",
        type: "REFUND"
      })
    ];

    expect(
      calculateCreditCardState(
        cardSource({ initialOutstandingDebt: 100 }),
        transactions
      )
    ).toEqual({
      availableCredit: 1000,
      cardCredit: 140,
      outstandingDebt: 0
    });
  });

  it("calculateCreditCardState - refund when debt = 0 (Case C)", () => {
    const transactions = [
      cardTx({
        amount: 55,
        toMoneySourceId: "card-1",
        type: "REFUND"
      })
    ];

    expect(calculateCreditCardState(cardSource(), transactions)).toEqual({
      availableCredit: 1000,
      cardCredit: 55,
      outstandingDebt: 0
    });
  });

  it("calculateGoalProgress - contributions and withdrawals", () => {
    const contributions = [
      goalContribution({ amount: 400 }),
      goalContribution({ amount: 75, type: "WITHDRAWAL" }),
      goalContribution({ amount: 125 })
    ];

    expect(calculateGoalProgress(contributions, 1000)).toEqual({
      netContributed: 450,
      progressPercent: 45,
      remaining: 550
    });
  });

  it("overContributionCheck - blocked with transaction link", () => {
    expect(
      validateContributionAgainstTransaction({
        amount: 60,
        existingLinkedAmount: 50,
        isManualAdjustment: false,
        transactionAmount: 100,
        transactionId: "tx-1"
      })
    ).toEqual({
      error: overContributionError,
      ok: false
    });
  });

  it("overContributionCheck - bypassed with isManualAdjustment", () => {
    expect(
      validateContributionAgainstTransaction({
        amount: 60,
        existingLinkedAmount: 50,
        isManualAdjustment: true,
        transactionAmount: 100,
        transactionId: "tx-1"
      })
    ).toEqual({ ok: true });
  });

  it("overContributionCheck - no check when transactionId = null", () => {
    expect(
      validateContributionAgainstTransaction({
        amount: 500,
        existingLinkedAmount: 500,
        isManualAdjustment: false,
        transactionAmount: 100,
        transactionId: null
      })
    ).toEqual({ ok: true });
  });

  it("calculateProjectSummary - profit and ROI", () => {
    const transactions = [
      projectTx({ amount: 1000, type: "INCOME" }),
      projectTx({ amount: 400, type: "EXPENSE" })
    ];

    expect(calculateProjectSummary(transactions)).toEqual({
      profit: 600,
      roi: 150,
      totalExpense: 400,
      totalIncome: 1000
    });
  });

  it("calculateProjectSummary - zero expense -> ROI is null", () => {
    const transactions = [projectTx({ amount: 800, type: "INCOME" })];

    expect(calculateProjectSummary(transactions)).toEqual({
      profit: 800,
      roi: null,
      totalExpense: 0,
      totalIncome: 800
    });
  });

  it("calculateFeeWaiverState - basic eligible spending", () => {
    const source = cardSource({
      annualFeeWaiverSpendTarget: 1000,
      waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
      waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z")
    });
    const transactions = [
      cardTx({
        amount: 250,
        countTowardFeeWaiver: true,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(calculateFeeWaiverState(source, transactions)).toEqual({
      eligibleSpending: 250,
      progress: 25,
      remaining: 750
    });
  });

  it("calculateFeeWaiverState - refund deducted from eligible", () => {
    const source = cardSource({
      annualFeeWaiverSpendTarget: 1000,
      waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
      waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z")
    });
    const transactions = [
      cardTx({
        id: "expense-1",
        amount: 300,
        countTowardFeeWaiver: true,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      }),
      cardTx({
        amount: 80,
        relatedTransactionId: "expense-1",
        toMoneySourceId: "card-1",
        type: "REFUND"
      })
    ];

    expect(calculateFeeWaiverState(source, transactions)).toEqual({
      eligibleSpending: 220,
      progress: 22,
      remaining: 780
    });
  });

  it("calculateFeeWaiverState - non-eligible transaction excluded", () => {
    const source = cardSource({
      annualFeeWaiverSpendTarget: 1000,
      waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
      waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z")
    });
    const transactions = [
      cardTx({
        amount: 300,
        countTowardFeeWaiver: false,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      }),
      cardTx({
        amount: 200,
        countTowardFeeWaiver: true,
        fromMoneySourceId: "card-2",
        type: "EXPENSE"
      }),
      cardTx({
        amount: 100,
        countTowardFeeWaiver: true,
        fromMoneySourceId: "card-1",
        transactionDate: new Date("2027-01-01T00:00:00.000Z"),
        type: "EXPENSE"
      })
    ];

    expect(calculateFeeWaiverState(source, transactions)).toEqual({
      eligibleSpending: 0,
      progress: 0,
      remaining: 1000
    });
  });

  it("calculateFeeWaiverState - target zero or null returns 0 progress", () => {
    const transactions = [
      cardTx({
        amount: 500,
        countTowardFeeWaiver: true,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(
      calculateFeeWaiverState(
        cardSource({ annualFeeWaiverSpendTarget: 0 }),
        transactions
      )
    ).toEqual({
      eligibleSpending: 0,
      progress: 0,
      remaining: 0
    });
    expect(
      calculateFeeWaiverState(
        cardSource({ annualFeeWaiverSpendTarget: null }),
        transactions
      )
    ).toEqual({
      eligibleSpending: 0,
      progress: 0,
      remaining: 0
    });
  });

  it("calculateFeeWaiverState - remaining floors at 0", () => {
    const source = cardSource({ annualFeeWaiverSpendTarget: 100 });
    const transactions = [
      cardTx({
        amount: 150,
        countTowardFeeWaiver: true,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(calculateFeeWaiverState(source, transactions)).toEqual({
      eligibleSpending: 150,
      progress: 150,
      remaining: 0
    });
  });

  it("calculateNextDueDate - DAILY", () => {
    expect(
      calculateNextDueDate(new Date("2026-07-06T00:00:00.000Z"), "DAILY", 1)
    ).toEqual(new Date("2026-07-07T00:00:00.000Z"));
  });

  it("calculateNextDueDate - WEEKLY", () => {
    expect(
      calculateNextDueDate(new Date("2026-07-06T00:00:00.000Z"), "WEEKLY", 1)
    ).toEqual(new Date("2026-07-13T00:00:00.000Z"));
  });

  it("calculateNextDueDate - MONTHLY", () => {
    expect(
      calculateNextDueDate(new Date("2026-07-15T00:00:00.000Z"), "MONTHLY", 1)
    ).toEqual(new Date("2026-08-15T00:00:00.000Z"));
  });

  it("calculateNextDueDate - YEARLY", () => {
    expect(
      calculateNextDueDate(new Date("2026-07-15T00:00:00.000Z"), "YEARLY", 1)
    ).toEqual(new Date("2027-07-15T00:00:00.000Z"));
  });

  it("calculateNextDueDate - intervalCount = 2", () => {
    expect(
      calculateNextDueDate(new Date("2026-07-06T00:00:00.000Z"), "WEEKLY", 2)
    ).toEqual(new Date("2026-07-20T00:00:00.000Z"));
  });

  it("validateTransactionFields - each type's from/to rules", () => {
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: null,
          toMoneySourceId: "bank-1",
          type: "INCOME"
        })
      )
    ).toEqual({ errors: [], ok: true });
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: "bank-1",
          toMoneySourceId: null,
          type: "EXPENSE"
        })
      )
    ).toEqual({ errors: [], ok: true });
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: "bank-1",
          toMoneySourceId: "cash-1",
          type: "TRANSFER"
        })
      )
    ).toEqual({ errors: [], ok: true });
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: null,
          toMoneySourceId: "bank-1",
          type: "REFUND"
        })
      )
    ).toEqual({ errors: [], ok: true });
    expect(
      validateTransactionFields(
        validation({
          adjustedMoneySourceId: "bank-1",
          adjustmentDirection: "INCREASE",
          fromMoneySourceId: null,
          toMoneySourceId: null,
          type: "ADJUSTMENT"
        })
      )
    ).toEqual({ errors: [], ok: true });
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: "bank-1",
          toMoneySourceId: null,
          type: "INCOME"
        })
      ).errors
    ).toEqual([
      "Income cannot have a from money source.",
      "Income requires a to money source."
    ]);
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: null,
          toMoneySourceId: "bank-1",
          type: "EXPENSE"
        })
      ).errors
    ).toEqual([
      "Expense requires a from money source.",
      "Expense cannot have a to money source."
    ]);
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: "bank-1",
          toMoneySourceId: "bank-1",
          type: "TRANSFER"
        })
      ).errors
    ).toEqual(["Transfer money sources must be different."]);
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: "bank-1",
          toMoneySourceId: null,
          type: "REFUND"
        })
      ).errors
    ).toEqual([
      "Refund cannot have a from money source.",
      "Refund requires a to money source."
    ]);
    expect(
      validateTransactionFields(
        validation({
          adjustedMoneySourceId: null,
          adjustmentDirection: null,
          fromMoneySourceId: "bank-1",
          toMoneySourceId: "cash-1",
          type: "ADJUSTMENT"
        })
      ).errors
    ).toEqual([
      "Adjustment cannot have from or to money sources.",
      "Adjustment requires an adjusted money source.",
      "Adjustment requires an adjustment direction."
    ]);
  });

  it("validateTransactionFields - qualityRating rejected on non-EXPENSE", () => {
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: null,
          qualityRating: "A",
          toMoneySourceId: "bank-1",
          type: "INCOME"
        })
      )
    ).toEqual({
      errors: ["Quality rating is only valid for expenses."],
      ok: false
    });
    expect(
      validateTransactionFields(
        validation({
          fromMoneySourceId: "bank-1",
          qualityRating: "A",
          toMoneySourceId: null,
          type: "EXPENSE"
        })
      )
    ).toEqual({ errors: [], ok: true });
  });

  it("countTowardFeeWaiverDefault - pre-fills true for credit card expense", () => {
    expect(
      getCountTowardFeeWaiverDefault(
        {
          fromMoneySourceId: "card-1",
          type: "EXPENSE"
        },
        [{ id: "card-1", type: "CREDIT_CARD" }]
      )
    ).toBe(true);
  });

  it("countTowardFeeWaiverDefault - stays false for TRANSFER / INCOME / REFUND", () => {
    const sources: FeeWaiverSource[] = [{ id: "card-1", type: "CREDIT_CARD" }];

    expect(
      getCountTowardFeeWaiverDefault(
        { fromMoneySourceId: "card-1", type: "TRANSFER" },
        sources
      )
    ).toBe(false);
    expect(
      getCountTowardFeeWaiverDefault(
        { fromMoneySourceId: "card-1", type: "INCOME" },
        sources
      )
    ).toBe(false);
    expect(
      getCountTowardFeeWaiverDefault(
        { fromMoneySourceId: "card-1", type: "REFUND" },
        sources
      )
    ).toBe(false);
  });

  it("adjustmentDirectionEffect - INCREASE adds to balance", () => {
    expect(adjustmentDirectionEffect(75, "INCREASE")).toBe(75);
  });

  it("adjustmentDirectionEffect - DECREASE subtracts from balance", () => {
    expect(adjustmentDirectionEffect(75, "DECREASE")).toBe(-75);
  });

  it("calculateNetSavings - normal case", () => {
    const transactions = [
      dashboardTx({ amount: 1000, type: "INCOME" }),
      dashboardTx({ amount: 250, type: "EXPENSE" }),
      dashboardTx({ amount: 100, type: "TRANSFER" })
    ];

    expect(calculateNetSavings(transactions)).toEqual({
      netSavings: 750,
      savingRate: 75,
      totalExpense: 250,
      totalIncome: 1000
    });
  });

  it("calculateNetSavings - zero income -> saving rate = 0", () => {
    const transactions = [dashboardTx({ amount: 250, type: "EXPENSE" })];

    expect(calculateNetSavings(transactions)).toEqual({
      netSavings: -250,
      savingRate: 0,
      totalExpense: 250,
      totalIncome: 0
    });
  });

  it("calculateSpendingQualityBreakdown - correct grouping", () => {
    const transactions = [
      reportTx({ amount: 100, qualityRating: "A" }),
      reportTx({ amount: 50, qualityRating: "A" }),
      reportTx({ amount: 75, qualityRating: "C" }),
      reportTx({ amount: 999, qualityRating: null }),
      reportTx({ amount: 500, type: "INCOME" })
    ];

    expect(getSpendingQualityBreakdown(transactions)).toEqual([
      { count: 2, rating: "A", total: 150 },
      { count: 1, rating: "C", total: 75 }
    ]);
  });

  it("calculateEstimatedNetPosition - assets minus card debt", () => {
    const moneySources = [
      dashboardSource({
        id: "bank-1",
        openingBalance: 1000,
        type: "BANK_ACCOUNT"
      }),
      dashboardSource({
        id: "cash-1",
        openingBalance: 200,
        type: "CASH"
      }),
      dashboardSource({
        id: "card-1",
        initialCardCredit: 0,
        initialOutstandingDebt: 100,
        openingBalance: 9999,
        type: "CREDIT_CARD"
      })
    ];
    const transactions = [
      dashboardTx({
        amount: 300,
        toMoneySourceId: "bank-1",
        type: "INCOME"
      }),
      dashboardTx({
        amount: 125,
        fromMoneySourceId: "cash-1",
        type: "EXPENSE"
      }),
      dashboardTx({
        amount: 50,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(calculateEstimatedNetPosition(moneySources, transactions)).toBe(1225);
  });

  it("ownershipGuard - passes when userId matches, throws when not", () => {
    const record = { id: "record-1", userId: "user-1" };

    expect(ownershipGuard(record, "user-1")).toBe(record);
    expect(() => ownershipGuard(record, "user-2")).toThrow(
      "Record not found or access denied."
    );
    expect(() => ownershipGuard(null, "user-1")).toThrow(
      "Record not found or access denied."
    );
  });
});
