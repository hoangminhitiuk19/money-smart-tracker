import {
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/(protected)/dashboard/page";
import { getDashboardData } from "@/lib/actions/dashboard";
import {
  calculateAccountProjection,
  getDashboardSummary,
  type DashboardMoneySource,
  type DashboardTransaction
} from "@/lib/calc/dashboard";

const dashboardMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  transactionFindMany: vi.fn(),
  savingGoalFindMany: vi.fn(),
  financialProjectFindMany: vi.fn(),
  moneySourceFindMany: vi.fn(),
  recurringPaymentFindMany: vi.fn()
}));

vi.mock("@/lib/auth", () => ({ requireAuth: dashboardMocks.requireAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: dashboardMocks.transactionFindMany },
    savingGoal: { findMany: dashboardMocks.savingGoalFindMany },
    financialProject: { findMany: dashboardMocks.financialProjectFindMany },
    moneySource: { findMany: dashboardMocks.moneySourceFindMany },
    recurringPayment: { findMany: dashboardMocks.recurringPaymentFindMany }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  dashboardMocks.requireAuth.mockResolvedValue({ id: "dashboard-user" });
  dashboardMocks.transactionFindMany.mockResolvedValue([]);
  dashboardMocks.savingGoalFindMany.mockResolvedValue([]);
  dashboardMocks.financialProjectFindMany.mockResolvedValue([]);
  dashboardMocks.moneySourceFindMany.mockResolvedValue([]);
  dashboardMocks.recurringPaymentFindMany.mockResolvedValue([]);
});

const today = new Date("2026-07-15T00:00:00.000Z");

function tx(
  transaction: Partial<DashboardTransaction>
): DashboardTransaction {
  return {
    id: "dashboard-transaction",
    amount: 100,
    createdAt: new Date("2026-07-10T00:00:01.000Z"),
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

type DashboardContentElement = ReactElement<{
  searchParams: Record<string, string | string[] | undefined>;
}> & {
  type: (props: {
    searchParams: Record<string, string | string[] | undefined>;
  }) => Promise<ReactElement>;
};

async function renderDashboardMarkup() {
  const shell = (await DashboardPage({
    searchParams: Promise.resolve({ period: "month" })
  })) as ReactElement<{ children: DashboardContentElement }>;
  const contentElement = shell.props.children;
  const content = await contentElement.type(contentElement.props);
  return renderToStaticMarkup(content);
}

describe("getDashboardSummary", () => {
  it("calculates total income correctly", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 800, type: TransactionType.INCOME }),
          tx({ amount: 200, type: TransactionType.INCOME })
        ]
      }).totalIncome.toFixed(2)
    ).toBe("1000.00");
  });

  it("calculates total expense correctly", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 250, type: TransactionType.EXPENSE }),
          tx({ amount: 150, type: TransactionType.EXPENSE })
        ]
      }).totalExpense.toFixed(2)
    ).toBe("400.00");
  });

  it("calculates net savings correctly", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 1000, type: TransactionType.INCOME }),
          tx({ amount: 350, type: TransactionType.EXPENSE })
        ]
      }).netSavings.toFixed(2)
    ).toBe("650.00");
  });

  it("calculates saving rate for a normal case", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 1000, type: TransactionType.INCOME }),
          tx({ amount: 250, type: TransactionType.EXPENSE })
        ]
      }).savingRate.toDecimalPlaces(8).toString()
    ).toBe("75");
  });

  it("returns zero saving rate when income is zero", () => {
    expect(
      summary({
        transactions: [tx({ amount: 250, type: TransactionType.EXPENSE })]
      }).savingRate.toDecimalPlaces(8).toString()
    ).toBe("0");
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

    expect(result.S.count).toBe(1);
    expect(result.S.amount.toFixed(2)).toBe("10.00");
    expect(result.A.count).toBe(1);
    expect(result.A.amount.toFixed(2)).toBe("20.00");
    expect(result.B.count).toBe(1);
    expect(result.B.amount.toFixed(2)).toBe("30.00");
    expect(result.C.count).toBe(1);
    expect(result.C.amount.toFixed(2)).toBe("40.00");
    expect(result.D.count).toBe(1);
    expect(result.D.amount.toFixed(2)).toBe("50.00");
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
      }).highQualityPercent.toDecimalPlaces(8).toString()
    ).toBe("50");
  });

  it("returns zero high-quality percent when there are no rated expenses", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 100, qualityRating: null }),
          tx({ amount: 100, qualityRating: undefined })
        ]
      }).highQualityPercent.toDecimalPlaces(8).toString()
    ).toBe("0");
  });

  it("calculates low-quality amount as C plus D", () => {
    expect(
      summary({
        transactions: [
          tx({ amount: 100, qualityRating: QualityRating.C }),
          tx({ amount: 125, qualityRating: QualityRating.D }),
          tx({ amount: 900, qualityRating: QualityRating.B })
        ]
      }).lowQualityAmount.toFixed(2)
    ).toBe("225.00");
  });

  it("groups spending by source correctly", () => {
    const result = summary({
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
      }).spendingBySource;

    expect(result.bank.toFixed(2)).toBe("75.00");
    expect(result.cash.toFixed(2)).toBe("325.00");
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
      }).estimatedNetPosition.toFixed(2)
    ).toBe("900.00");
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
      }).estimatedNetPosition.toFixed(2)
    ).toBe("1000.00");
  });

  it("includes only the exact asset whitelist and excludes OTHER from net position", () => {
    expect(
      summary({
        moneySources: [
          source({
            id: "cash",
            openingBalance: 100,
            type: MoneySourceType.CASH
          }),
          source({
            id: "bank",
            openingBalance: 200,
            type: MoneySourceType.BANK_ACCOUNT
          }),
          source({
            id: "debit",
            openingBalance: 300,
            type: MoneySourceType.DEBIT_CARD
          }),
          source({
            id: "wallet",
            openingBalance: 400,
            type: MoneySourceType.E_WALLET
          }),
          source({
            id: "investment",
            openingBalance: 500,
            type: MoneySourceType.INVESTMENT
          }),
          source({
            id: "other",
            openingBalance: 999,
            type: MoneySourceType.OTHER
          }),
          source({
            id: "card",
            initialCardCredit: 0,
            initialOutstandingDebt: 100,
            openingBalance: 0,
            type: MoneySourceType.CREDIT_CARD
          })
        ]
      }).estimatedNetPosition.toFixed(2)
    ).toBe("1400.00");
  });
});

describe("calculateAccountProjection", () => {
  it("uses tracked debt as the card primary amount and keeps card credit separate", () => {
    const result = calculateAccountProjection(
      source({
        id: "card",
        type: MoneySourceType.CREDIT_CARD,
        openingBalance: 9999,
        creditLimit: 2000,
        initialOutstandingDebt: 85,
        initialCardCredit: 15
      }),
      []
    );

    expect(result.trackedAmount.toFixed(2)).toBe("85.00");
    expect(result.cardCredit?.toFixed(2)).toBe("15.00");
    expect(result.creditCardState?.availableCredit.toFixed(2)).toBe("1915.00");
  });

  it("retains the generic tracked balance for non-card sources", () => {
    const result = calculateAccountProjection(
      source({ id: "bank", openingBalance: 100 }),
      [
        tx({
          id: "bank-income",
          amount: 25,
          type: TransactionType.INCOME,
          toMoneySourceId: "bank"
        })
      ]
    );

    expect(result.trackedAmount.toFixed(2)).toBe("125.00");
    expect(result.cardCredit).toBeNull();
    expect(result.creditCardState).toBeNull();
  });
});

describe("getDashboardData date filtering", () => {
  it("queries through the UTC start of the day after an inclusive end date", async () => {
    await getDashboardData("2026-07-01", "2026-07-30");

    expect(dashboardMocks.transactionFindMany).toHaveBeenCalledWith({
      where: {
        userId: "dashboard-user",
        transactionDate: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lt: new Date("2026-07-31T00:00:00.000Z")
        }
      },
      orderBy: { transactionDate: "desc" }
    });
    expect(dashboardMocks.transactionFindMany).toHaveBeenNthCalledWith(2, {
      where: { userId: "dashboard-user" },
      orderBy: { transactionDate: "desc" }
    });
  });
});

describe("dashboard card visibility", () => {
  it("shows only active card widgets while retaining inactive card debt in net position", async () => {
    dashboardMocks.moneySourceFindMany
      .mockResolvedValueOnce([
        {
          id: "bank",
          userId: "dashboard-user",
          name: "Dashboard bank",
          type: MoneySourceType.BANK_ACCOUNT,
          currency: "VND",
          openingBalance: 200,
          isActive: true
        },
        {
          id: "active-card",
          userId: "dashboard-user",
          name: "Active dashboard card",
          type: MoneySourceType.CREDIT_CARD,
          currency: "VND",
          openingBalance: 0,
          creditLimit: 1000,
          initialOutstandingDebt: 25,
          initialCardCredit: 0,
          isActive: true,
          annualFeeWaiverEnabled: true,
          annualFeeWaiverSpendTarget: 100
        },
        {
          id: "inactive-card",
          userId: "dashboard-user",
          name: "Inactive dashboard card",
          type: MoneySourceType.CREDIT_CARD,
          currency: "VND",
          openingBalance: 0,
          creditLimit: 1000,
          initialOutstandingDebt: 75,
          initialCardCredit: 0,
          isActive: false,
          annualFeeWaiverEnabled: true,
          annualFeeWaiverSpendTarget: 100
        }
      ])
      .mockResolvedValueOnce([]);

    const result = await getDashboardData("2026-07-01", "2026-07-31");

    expect(result.summary.estimatedNetPosition.toFixed(2)).toBe("100.00");
    expect(result.creditCards.map(({ source }) => source.id)).toEqual([
      "active-card"
    ]);
    expect(result.feeWaivers.map(({ source }) => source.id)).toEqual([
      "active-card"
    ]);
  });
});

describe("dashboard horizon labels", () => {
  it("labels selected-period metrics and current tracked state", async () => {
    dashboardMocks.moneySourceFindMany
      .mockResolvedValueOnce([
        {
          id: "dashboard-card",
          userId: "dashboard-user",
          name: "Dashboard card",
          type: MoneySourceType.CREDIT_CARD,
          currency: "VND",
          openingBalance: 0,
          creditLimit: 1000,
          initialOutstandingDebt: 0,
          initialCardCredit: 0,
          isActive: true,
          annualFeeWaiverEnabled: false
        }
      ])
      .mockResolvedValueOnce([]);

    const markup = await renderDashboardMarkup();

    expect(markup.match(/Selected period/g) ?? []).toHaveLength(4);
    expect(markup.match(/Current tracked estimate/g) ?? []).toHaveLength(2);
  });
});
