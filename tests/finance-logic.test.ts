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
    id: "card-transaction",
    amount: 100,
    createdAt: new Date("2026-07-10T00:00:01.000Z"),
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
    id: "dashboard-transaction",
    amount: 100,
    createdAt: new Date("2026-07-10T00:00:01.000Z"),
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

function creditStateText(
  state: ReturnType<typeof calculateCreditCardState>
) {
  return {
    availableCredit: state.availableCredit.toFixed(2),
    cardCredit: state.cardCredit.toFixed(2),
    outstandingDebt: state.outstandingDebt.toFixed(2)
  };
}

function goalProgressText(
  progress: ReturnType<typeof calculateGoalProgress>
) {
  return {
    netContributed: progress.netContributed.toFixed(2),
    progressPercent: progress.progressPercent.toDecimalPlaces(8).toString(),
    remaining: progress.remaining.toFixed(2)
  };
}

function projectSummaryText(
  summary: ReturnType<typeof calculateProjectSummary>
) {
  return {
    profit: summary.profit.toFixed(2),
    roi: summary.roi?.toDecimalPlaces(8).toString() ?? null,
    totalExpense: summary.totalExpense.toFixed(2),
    totalIncome: summary.totalIncome.toFixed(2)
  };
}

function feeWaiverStateText(
  state: ReturnType<typeof calculateFeeWaiverState>
) {
  return {
    eligibleSpending: state.eligibleSpending.toFixed(2),
    progress: state.progress.toDecimalPlaces(8).toString(),
    remaining: state.remaining.toFixed(2)
  };
}

function netSavingsText(
  result: ReturnType<typeof calculateNetSavings>
) {
  return {
    netSavings: result.netSavings.toFixed(2),
    savingRate: result.savingRate.toDecimalPlaces(8).toString(),
    totalExpense: result.totalExpense.toFixed(2),
    totalIncome: result.totalIncome.toFixed(2)
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

    expect(calculateTrackedBalance(bankSource, transactions).toFixed(2)).toBe(
      "1250.00"
    );
  });

  it("calculateTrackedBalance - expense decreases balance", () => {
    const transactions = [
      balanceTx({
        amount: 175,
        fromMoneySourceId: bankSource.id,
        type: "EXPENSE"
      })
    ];

    expect(calculateTrackedBalance(bankSource, transactions).toFixed(2)).toBe(
      "825.00"
    );
  });

  it("calculateTrackedBalance - REFUND increases balance", () => {
    const transactions = [
      balanceTx({
        amount: 60,
        toMoneySourceId: bankSource.id,
        type: "REFUND"
      })
    ];

    expect(calculateTrackedBalance(bankSource, transactions).toFixed(2)).toBe(
      "1060.00"
    );
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

    expect(calculateTrackedBalance(bankSource, transactions).toFixed(2)).toBe(
      "1175.00"
    );
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

    expect(calculateTrackedBalance(bankSource, transactions).toFixed(2)).toBe(
      "1055.00"
    );
  });

  it("calculateCreditCardState - expense with no card credit increases debt", () => {
    const transactions = [
      cardTx({
        amount: 120,
        fromMoneySourceId: "card-1",
        type: "EXPENSE"
      })
    ];

    expect(
      creditStateText(calculateCreditCardState(cardSource(), transactions))
    ).toEqual({
      availableCredit: "880.00",
      cardCredit: "0.00",
      outstandingDebt: "120.00"
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
      creditStateText(
        calculateCreditCardState(
          cardSource({ initialCardCredit: 200 }),
          transactions
        )
      )
    ).toEqual({
      availableCredit: "1000.00",
      cardCredit: "120.00",
      outstandingDebt: "0.00"
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
      creditStateText(
        calculateCreditCardState(
          cardSource({ initialCardCredit: 100 }),
          transactions
        )
      )
    ).toEqual({
      availableCredit: "850.00",
      cardCredit: "0.00",
      outstandingDebt: "150.00"
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
      creditStateText(
        calculateCreditCardState(
          cardSource({ initialOutstandingDebt: 500 }),
          transactions
        )
      )
    ).toEqual({
      availableCredit: "675.00",
      cardCredit: "0.00",
      outstandingDebt: "325.00"
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
      creditStateText(
        calculateCreditCardState(
          cardSource({ initialOutstandingDebt: 125 }),
          transactions
        )
      )
    ).toEqual({
      availableCredit: "1000.00",
      cardCredit: "175.00",
      outstandingDebt: "0.00"
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
      creditStateText(
        calculateCreditCardState(
          cardSource({ initialOutstandingDebt: 300 }),
          transactions
        )
      )
    ).toEqual({
      availableCredit: "790.00",
      cardCredit: "0.00",
      outstandingDebt: "210.00"
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
      creditStateText(
        calculateCreditCardState(
          cardSource({ initialOutstandingDebt: 100 }),
          transactions
        )
      )
    ).toEqual({
      availableCredit: "1000.00",
      cardCredit: "140.00",
      outstandingDebt: "0.00"
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

    expect(
      creditStateText(calculateCreditCardState(cardSource(), transactions))
    ).toEqual({
      availableCredit: "1000.00",
      cardCredit: "55.00",
      outstandingDebt: "0.00"
    });
  });

  it("calculateGoalProgress - contributions and withdrawals", () => {
    const contributions = [
      goalContribution({ amount: 400 }),
      goalContribution({ amount: 75, type: "WITHDRAWAL" }),
      goalContribution({ amount: 125 })
    ];

    expect(
      goalProgressText(calculateGoalProgress(contributions, 1000))
    ).toEqual({
      netContributed: "450.00",
      progressPercent: "45",
      remaining: "550.00"
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

    expect(projectSummaryText(calculateProjectSummary(transactions))).toEqual({
      profit: "600.00",
      roi: "150",
      totalExpense: "400.00",
      totalIncome: "1000.00"
    });
  });

  it("calculateProjectSummary - zero expense -> ROI is null", () => {
    const transactions = [projectTx({ amount: 800, type: "INCOME" })];

    expect(projectSummaryText(calculateProjectSummary(transactions))).toEqual({
      profit: "800.00",
      roi: null,
      totalExpense: "0.00",
      totalIncome: "800.00"
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

    expect(
      feeWaiverStateText(calculateFeeWaiverState(source, transactions))
    ).toEqual({
      eligibleSpending: "250.00",
      progress: "25",
      remaining: "750.00"
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

    expect(
      feeWaiverStateText(calculateFeeWaiverState(source, transactions))
    ).toEqual({
      eligibleSpending: "220.00",
      progress: "22",
      remaining: "780.00"
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

    expect(
      feeWaiverStateText(calculateFeeWaiverState(source, transactions))
    ).toEqual({
      eligibleSpending: "0.00",
      progress: "0",
      remaining: "1000.00"
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
      feeWaiverStateText(
        calculateFeeWaiverState(
          cardSource({ annualFeeWaiverSpendTarget: 0 }),
          transactions
        )
      )
    ).toEqual({
      eligibleSpending: "0.00",
      progress: "0",
      remaining: "0.00"
    });
    expect(
      feeWaiverStateText(
        calculateFeeWaiverState(
          cardSource({ annualFeeWaiverSpendTarget: null }),
          transactions
        )
      )
    ).toEqual({
      eligibleSpending: "0.00",
      progress: "0",
      remaining: "0.00"
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

    expect(
      feeWaiverStateText(calculateFeeWaiverState(source, transactions))
    ).toEqual({
      eligibleSpending: "150.00",
      progress: "150",
      remaining: "0.00"
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

    expect(netSavingsText(calculateNetSavings(transactions))).toEqual({
      netSavings: "750.00",
      savingRate: "75",
      totalExpense: "250.00",
      totalIncome: "1000.00"
    });
  });

  it("calculateNetSavings - zero income -> saving rate = 0", () => {
    const transactions = [dashboardTx({ amount: 250, type: "EXPENSE" })];

    expect(netSavingsText(calculateNetSavings(transactions))).toEqual({
      netSavings: "-250.00",
      savingRate: "0",
      totalExpense: "250.00",
      totalIncome: "0.00"
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

    const breakdown = getSpendingQualityBreakdown(transactions);

    expect(breakdown[0].count).toBe(2);
    expect(breakdown[0].rating).toBe("A");
    expect(breakdown[0].total.toFixed(2)).toBe("150.00");
    expect(breakdown[1].count).toBe(1);
    expect(breakdown[1].rating).toBe("C");
    expect(breakdown[1].total.toFixed(2)).toBe("75.00");
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

    expect(
      calculateEstimatedNetPosition(moneySources, transactions).toFixed(2)
    ).toBe("1225.00");
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
