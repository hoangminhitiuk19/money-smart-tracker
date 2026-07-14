import {
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getDashboardSummary,
  type DashboardMoneySource,
  type DashboardTransaction
} from "@/lib/calc/dashboard";

const today = new Date("2026-07-15T00:00:00.000Z");

function tx(
  transaction: Partial<DashboardTransaction>
): DashboardTransaction {
  return {
    amount: 100,
    transactionDate: new Date("2026-07-10T00:00:00.000Z"),
    type: TransactionType.EXPENSE,
    ...transaction
  };
}

function source(
  moneySource: Partial<DashboardMoneySource>
): DashboardMoneySource {
  return {
    id: "source-1",
    openingBalance: 0,
    type: MoneySourceType.BANK_ACCOUNT,
    ...moneySource
  };
}

function summary({
  moneySources = [],
  transactions = []
}: {
  moneySources?: DashboardMoneySource[];
  transactions?: DashboardTransaction[];
} = {}) {
  return getDashboardSummary(
    transactions,
    [],
    [],
    moneySources,
    [],
    today
  );
}

describe("getDashboardSummary", () => {
  it("calculates total income correctly", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 800, type: TransactionType.INCOME }),
          tx({ amount: 200, type: TransactionType.INCOME })
        ]
      }).totalIncome
    ).toBe(1000);
  });

  it("calculates total expense correctly", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 250, type: TransactionType.EXPENSE }),
          tx({ amount: 150, type: TransactionType.EXPENSE })
        ]
      }).totalExpense
    ).toBe(400);
  });

  it("calculates net savings correctly", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 1000, type: TransactionType.INCOME }),
          tx({ amount: 350, type: TransactionType.EXPENSE })
        ]
      }).netSavings
    ).toBe(650);
  });

  it("calculates saving rate for a normal case", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 1000, type: TransactionType.INCOME }),
          tx({ amount: 250, type: TransactionType.EXPENSE })
        ]
      }).savingRate
    ).toBe(75);
  });

  it("returns zero saving rate when income is zero", () => {
    expect(
      summary({
        transactions: [tx({ amount: 250, type: TransactionType.EXPENSE })]
      }).savingRate
    ).toBe(0);
  });

  it("counts all five quality ratings separately", () => {
    const result = summary({
      transactions: [
        tx({ amount: 10, qualityRating: QualityRating.S }),
        tx({ amount: 20, qualityRating: QualityRating.A }),
        tx({ amount: 30, qualityRating: QualityRating.B }),
        tx({ amount: 40, qualityRating: QualityRating.C }),
        tx({ amount: 50, qualityRating: QualityRating.D })
      ]
    }).qualityBreakdown;

    expect(result.S).toEqual({ count: 1, amount: 10 });
    expect(result.A).toEqual({ count: 1, amount: 20 });
    expect(result.B).toEqual({ count: 1, amount: 30 });
    expect(result.C).toEqual({ count: 1, amount: 40 });
    expect(result.D).toEqual({ count: 1, amount: 50 });
  });

  it("calculates high-quality percent as S plus A over total rated", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 400, qualityRating: QualityRating.S }),
          tx({ amount: 100, qualityRating: QualityRating.A }),
          tx({ amount: 200, qualityRating: QualityRating.C }),
          tx({ amount: 300, qualityRating: QualityRating.D })
        ]
      }).highQualityPercent
    ).toBe(50);
  });

  it("returns zero high-quality percent when there are no rated expenses", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 100, qualityRating: null }),
          tx({ amount: 100, qualityRating: undefined })
        ]
      }).highQualityPercent
    ).toBe(0);
  });

  it("calculates low-quality amount as C plus D", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 100, qualityRating: QualityRating.C }),
          tx({ amount: 125, qualityRating: QualityRating.D }),
          tx({ amount: 900, qualityRating: QualityRating.B })
        ]
      }).lowQualityAmount
    ).toBe(225);
  });

  it("groups spending by source correctly", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 200, fromMoneySourceId: "cash" }),
          tx({ amount: 125, fromMoneySourceId: "cash" }),
          tx({ amount: 75, fromMoneySourceId: "bank" }),
          tx({
            amount: 500,
            toMoneySourceId: "cash",
            type: TransactionType.INCOME
          })
        ]
      }).spendingBySource
    ).toEqual({
      bank: 75,
      cash: 325
    });
  });

  it("calculates estimated net position as assets minus card debt", () => {
    expect(
      summary({
        moneySources: [
          source({ id: "bank", openingBalance: 1000 }),
          source({
            id: "card",
            initialCardCredit: 0,
            initialOutstandingDebt: 100,
            openingBalance: 0,
            type: MoneySourceType.CREDIT_CARD
          })
        ],
        transactions: [
          tx({
            amount: 500,
            toMoneySourceId: "bank",
            type: TransactionType.INCOME
          }),
          tx({
            amount: 200,
            fromMoneySourceId: "bank",
            type: TransactionType.EXPENSE
          }),
          tx({
            amount: 300,
            fromMoneySourceId: "card",
            type: TransactionType.EXPENSE
          })
        ]
      }).estimatedNetPosition
    ).toBe(900);
  });

  it("includes only non-card sources in assets for estimated net position", () => {
    expect(
      summary({
        moneySources: [
          source({ id: "bank", openingBalance: 1000 }),
          source({
            id: "card",
            initialCardCredit: 0,
            initialOutstandingDebt: 0,
            openingBalance: 9999,
            type: MoneySourceType.CREDIT_CARD
          })
        ],
        transactions: [
          tx({
            amount: 500,
            toMoneySourceId: "card",
            type: TransactionType.INCOME
          })
        ]
      }).estimatedNetPosition
    ).toBe(1000);
  });
});
