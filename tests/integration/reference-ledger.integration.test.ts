import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  CategoryType,
  ContributionType,
  MoneySourceType,
  QualityRating,
  RenewalFrequency,
  TransactionType,
  WaiverPeriod
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as exportTransactions } from "@/app/api/export/transactions/route";
import { createCategory } from "@/lib/actions/categories";
import { getDashboardData } from "@/lib/actions/dashboard";
import { createContribution } from "@/lib/actions/goal-contributions";
import { createGoal } from "@/lib/actions/goals";
import { createMoneySource } from "@/lib/actions/money-sources";
import { createProject } from "@/lib/actions/projects";
import { createRenewal } from "@/lib/actions/renewals";
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
import {
  createTransaction,
  deleteTransaction,
  updateTransaction
} from "@/lib/actions/transactions";
import { calculateTrackedBalance } from "@/lib/calc/balance";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";
import {
  REFERENCE_AMOUNTS,
  REFERENCE_DATES,
  REFERENCE_EXPECTED_LEDGER,
  REFERENCE_EXPORT_COLUMNS
} from "@/tests/integration/helpers/reference-ledger";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "reference-ledger@audit.invalid",
    name: "Reference ledger user"
  }))
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  checkExport: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 10,
    remaining: 9,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

type LedgerFixtures = {
  context: AuditContext;
  prefix: string;
  bankId: string;
  cashId: string;
  walletId: string;
  investmentId: string;
  cardId: string;
  eligibleCategoryId: string;
  dailyCategoryId: string;
  projectId: string;
  goalId: string;
  eligibleExpenseId: string;
  bankExpenseId: string;
  refundId: string;
  cardCreditAdjustmentId: string;
};

const contexts: AuditContext[] = [];
let fixtures: LedgerFixtures;

async function expectOk(result: Promise<{ ok: boolean; error?: string }>) {
  await expect(result).resolves.toEqual({ ok: true });
}

beforeAll(async () => {
  const context = await createAuditContext(`reference-${randomUUID()}`);
  contexts.push(context);
  authState.userId = context.userA.id;
  const prefix = `Reference ${randomUUID()}`;

  for (const source of [
    {
      name: `${prefix} Bank`,
      type: MoneySourceType.BANK_ACCOUNT,
      openingBalance: REFERENCE_AMOUNTS.bankOpeningBalance
    },
    {
      name: `${prefix} Cash`,
      type: MoneySourceType.CASH,
      openingBalance: "0.00"
    },
    {
      name: `${prefix} Wallet`,
      type: MoneySourceType.E_WALLET,
      openingBalance: "0.00"
    },
    {
      name: `${prefix} Investment`,
      type: MoneySourceType.INVESTMENT,
      openingBalance: REFERENCE_AMOUNTS.investmentOpeningBalance
    },
    {
      name: `${prefix} Card`,
      type: MoneySourceType.CREDIT_CARD,
      openingBalance: "0.00",
      creditLimit: "2000.00",
      annualFeeWaiverEnabled: true,
      annualFeeWaiverSpendTarget: REFERENCE_AMOUNTS.feeWaiverTarget,
      annualFeeWaiverPeriod: WaiverPeriod.MONTHLY,
      waiverPeriodStartDate: "2026-07-01",
      waiverPeriodEndDate: "2026-07-31"
    }
  ]) {
    await expectOk(createMoneySource(source));
  }
  await expectOk(
    createCategory({
      name: `${prefix} Eligible`,
      type: CategoryType.EXPENSE,
      defaultQualityRating: QualityRating.A,
      defaultCountTowardFeeWaiver: true
    })
  );
  await expectOk(
    createCategory({
      name: `${prefix} Daily`,
      type: CategoryType.EXPENSE,
      defaultQualityRating: QualityRating.D,
      defaultCountTowardFeeWaiver: false
    })
  );
  await expectOk(createProject({ name: `${prefix} Project` }));
  await expectOk(
    createGoal({
      name: `${prefix} Goal`,
      targetAmount: REFERENCE_AMOUNTS.goalTarget
    })
  );

  const [bank, cash, wallet, investment, card, eligibleCategory, dailyCategory, project, goal] =
    await Promise.all([
      prisma.moneySource.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Bank` }
      }),
      prisma.moneySource.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Cash` }
      }),
      prisma.moneySource.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Wallet` }
      }),
      prisma.moneySource.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Investment` }
      }),
      prisma.moneySource.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Card` }
      }),
      prisma.category.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Eligible` }
      }),
      prisma.category.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Daily` }
      }),
      prisma.financialProject.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Project` }
      }),
      prisma.savingGoal.findFirstOrThrow({
        where: { userId: context.userA.id, name: `${prefix} Goal` }
      })
    ]);

  await expectOk(
    createTransaction({
      type: TransactionType.INCOME,
      amount: REFERENCE_AMOUNTS.income,
      title: `${prefix} Income`,
      transactionDate: "2026-07-01",
      toMoneySourceId: bank.id,
      projectId: project.id
    })
  );
  await expectOk(
    createTransaction({
      type: TransactionType.EXPENSE,
      amount: REFERENCE_AMOUNTS.eligibleCardExpense,
      title: `${prefix} Eligible expense`,
      transactionDate: "2026-07-02",
      categoryId: eligibleCategory.id,
      qualityRating: QualityRating.A,
      fromMoneySourceId: card.id,
      projectId: project.id,
      countTowardFeeWaiver: true
    })
  );
  await expectOk(
    createTransaction({
      type: TransactionType.EXPENSE,
      amount: REFERENCE_AMOUNTS.bankExpense,
      title: `${prefix} Bank expense`,
      transactionDate: "2026-07-03",
      categoryId: dailyCategory.id,
      qualityRating: QualityRating.D,
      fromMoneySourceId: bank.id,
      projectId: project.id,
      countTowardFeeWaiver: false
    })
  );
  for (const transfer of [
    {
      amount: REFERENCE_AMOUNTS.cashTransfer,
      title: `${prefix} Cash transfer`,
      toMoneySourceId: cash.id,
      transactionDate: "2026-07-04"
    },
    {
      amount: REFERENCE_AMOUNTS.walletTransfer,
      title: `${prefix} Wallet transfer`,
      toMoneySourceId: wallet.id,
      transactionDate: "2026-07-05"
    },
    {
      amount: REFERENCE_AMOUNTS.cardPayment,
      title: `${prefix} Card payment`,
      toMoneySourceId: card.id,
      transactionDate: "2026-07-06"
    }
  ]) {
    await expectOk(
      createTransaction({
        type: TransactionType.TRANSFER,
        amount: transfer.amount,
        title: transfer.title,
        transactionDate: transfer.transactionDate,
        fromMoneySourceId: bank.id,
        toMoneySourceId: transfer.toMoneySourceId
      })
    );
  }
  const eligibleExpense = await prisma.transaction.findFirstOrThrow({
    where: {
      userId: context.userA.id,
      title: `${prefix} Eligible expense`
    }
  });
  await expectOk(
    createTransaction({
      type: TransactionType.REFUND,
      amount: REFERENCE_AMOUNTS.linkedRefund,
      title: `${prefix} Refund`,
      transactionDate: "2026-07-07",
      toMoneySourceId: bank.id,
      relatedTransactionId: eligibleExpense.id
    })
  );
  await expectOk(
    createTransaction({
      type: TransactionType.ADJUSTMENT,
      amount: REFERENCE_AMOUNTS.debtAdjustment,
      title: `${prefix} Debt adjustment`,
      transactionDate: "2026-07-08",
      adjustedMoneySourceId: card.id,
      adjustmentDirection: AdjustmentDirection.DECREASE,
      adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT
    })
  );
  await expectOk(
    createTransaction({
      type: TransactionType.ADJUSTMENT,
      amount: REFERENCE_AMOUNTS.cardCreditAdjustment,
      title: `${prefix} Credit adjustment`,
      transactionDate: "2026-07-09",
      adjustedMoneySourceId: card.id,
      adjustmentDirection: AdjustmentDirection.INCREASE,
      adjustmentTarget: AdjustmentTarget.CARD_CREDIT
    })
  );
  await expectOk(
    createContribution({
      savingGoalId: goal.id,
      fromMoneySourceId: bank.id,
      amount: REFERENCE_AMOUNTS.goalContribution,
      type: ContributionType.CONTRIBUTION,
      note: `${prefix} Goal contribution`,
      contributionDate: "2026-07-10"
    })
  );
  await expectOk(
    createRenewal({
      title: `${prefix} Renewal`,
      amount: REFERENCE_AMOUNTS.renewal,
      transactionType: TransactionType.EXPENSE,
      fromMoneySourceId: bank.id,
      categoryId: eligibleCategory.id,
      qualityRating: QualityRating.A,
      projectId: project.id,
      frequency: RenewalFrequency.MONTHLY,
      nextDueDate: REFERENCE_DATES.renewalDueDate
    })
  );

  const [bankExpense, refund, cardCreditAdjustment] = await Promise.all([
    prisma.transaction.findFirstOrThrow({
      where: { userId: context.userA.id, title: `${prefix} Bank expense` }
    }),
    prisma.transaction.findFirstOrThrow({
      where: { userId: context.userA.id, title: `${prefix} Refund` }
    }),
    prisma.transaction.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        title: `${prefix} Credit adjustment`
      }
    })
  ]);
  fixtures = {
    context,
    prefix,
    bankId: bank.id,
    cashId: cash.id,
    walletId: wallet.id,
    investmentId: investment.id,
    cardId: card.id,
    eligibleCategoryId: eligibleCategory.id,
    dailyCategoryId: dailyCategory.id,
    projectId: project.id,
    goalId: goal.id,
    eligibleExpenseId: eligibleExpense.id,
    bankExpenseId: bankExpense.id,
    refundId: refund.id,
    cardCreditAdjustmentId: cardCreditAdjustment.id
  };
}, 40_000);

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
}, 20_000);

const julyFilters = {
  startDate: REFERENCE_DATES.ledgerStart,
  endDate: REFERENCE_DATES.periodEndInclusive,
  groupBy: "month" as const
};

async function trackedBalance(sourceId: string) {
  const [source, transactions] = await Promise.all([
    prisma.moneySource.findFirstOrThrow({
      where: { id: sourceId, userId: fixtures.context.userA.id }
    }),
    prisma.transaction.findMany({
      where: { userId: fixtures.context.userA.id },
      orderBy: [
        { transactionDate: "asc" },
        { createdAt: "asc" },
        { id: "asc" }
      ]
    })
  ]);

  return calculateTrackedBalance(source, transactions);
}

async function reportProjection() {
  const filters = { ...julyFilters, projectId: fixtures.projectId };
  const [
    incomeExpense,
    categories,
    qualities,
    goals,
    projects,
    sources,
    cards,
    waivers,
    upcoming,
    recurring
  ] = await Promise.all([
    loadIncomeVsExpenseOverTime(filters),
    loadExpenseByCategory(filters),
    loadSpendingQualityBreakdown(filters),
    loadGoalProgressReport({
      ...julyFilters,
      savingGoalId: fixtures.goalId,
      moneySourceId: fixtures.bankId
    }),
    loadProjectProfitLoss(filters),
    loadSpendingBySource(filters),
    loadCreditCardDebtReport({
      ...julyFilters,
      moneySourceId: fixtures.cardId
    }),
    loadFeeWaiverReport({
      ...julyFilters,
      moneySourceId: fixtures.cardId
    }),
    loadUpcomingRenewalsTotal({
      startDate: "2026-07-01",
      endDate: "2026-12-31",
      projectId: fixtures.projectId
    }),
    loadRecurringExpensePerMonth({
      startDate: "2026-07-01",
      endDate: "2026-12-31",
      projectId: fixtures.projectId
    })
  ]);

  return {
    incomeExpense,
    categories,
    qualities,
    goals,
    projects,
    sources,
    cards,
    waivers,
    upcoming,
    recurring
  };
}

describe("action-entered reference ledger reconciliation", () => {
  it("reconciles literal balances, card state, dashboard, all reports, CSV, and activity", async () => {
    authState.userId = fixtures.context.userA.id;
    const [bank, cash, wallet, dashboard, reports] = await Promise.all([
      trackedBalance(fixtures.bankId),
      trackedBalance(fixtures.cashId),
      trackedBalance(fixtures.walletId),
      getDashboardData("2026-07-01", "2026-07-31"),
      reportProjection()
    ]);

    expect(bank.toFixed(2)).toBe(REFERENCE_EXPECTED_LEDGER.bankBalance);
    expect(cash.toFixed(2)).toBe(REFERENCE_EXPECTED_LEDGER.cashBalance);
    expect(wallet.toFixed(2)).toBe(REFERENCE_EXPECTED_LEDGER.walletBalance);
    expect(dashboard.creditCards[0]?.state.outstandingDebt.toFixed(2)).toBe(
      REFERENCE_EXPECTED_LEDGER.outstandingDebt
    );
    expect(dashboard.creditCards[0]?.state.cardCredit.toFixed(2)).toBe(
      REFERENCE_EXPECTED_LEDGER.cardCredit
    );
    expect(dashboard.summary.estimatedNetPosition.toFixed(2)).toBe(
      REFERENCE_EXPECTED_LEDGER.netPosition
    );
    expect(dashboard.feeWaivers[0]?.state.eligibleSpending.toFixed(2)).toBe(
      REFERENCE_EXPECTED_LEDGER.eligibleSpending
    );
    expect(dashboard.summary.totalIncome.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.income
    );
    expect(dashboard.summary.totalExpense.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.rawExpense
    );

    expect(reports.incomeExpense).toHaveLength(1);
    expect(reports.incomeExpense[0]?.income.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.income
    );
    expect(reports.incomeExpense[0]?.expense.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.effectiveExpense
    );
    expect(
      Object.fromEntries(
        reports.categories.map(({ categoryName, total }) => [
          categoryName,
          total.toFixed(2)
        ])
      )
    ).toEqual({
      [`${fixtures.prefix} Daily`]: "140.00",
      [`${fixtures.prefix} Eligible`]: "210.00"
    });
    expect(
      Object.fromEntries(
        reports.qualities.map(({ rating, total }) => [
          rating,
          total.toFixed(2)
        ])
      )
    ).toEqual({ A: "210.00", D: "140.00" });
    expect(reports.goals[0]?.progress.netContributed.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.goalContribution
    );
    expect(reports.goals[0]?.progress.progressPercent.toFixed(2)).toBe("20.00");
    expect(reports.projects[0]?.totalIncome.toFixed(2)).toBe("1000.00");
    expect(reports.projects[0]?.totalExpense.toFixed(2)).toBe("350.00");
    expect(reports.projects[0]?.profit.toFixed(2)).toBe("650.00");
    expect(
      Object.fromEntries(
        reports.sources.map(({ sourceName, total }) => [
          sourceName,
          total.toFixed(2)
        ])
      )
    ).toEqual({
      [`${fixtures.prefix} Bank`]: "140.00",
      [`${fixtures.prefix} Card`]: "210.00"
    });
    expect(reports.cards[0]?.state.outstandingDebt.toFixed(2)).toBe("85.00");
    expect(reports.cards[0]?.state.cardCredit.toFixed(2)).toBe("15.00");
    expect(reports.waivers[0]?.state.eligibleSpending.toFixed(2)).toBe("210.00");
    expect(reports.upcoming.count).toBe(1);
    expect(reports.upcoming.total.toFixed(2)).toBe(
      REFERENCE_AMOUNTS.renewal
    );
    expect(
      reports.recurring.map(({ period, total }) => ({
        period,
        total: total.toFixed(2)
      }))
    ).toEqual([{ period: "2026-08", total: REFERENCE_AMOUNTS.renewal }]);

    const response = await exportTransactions(
      new Request(
        "http://localhost/api/export/transactions?startDate=2026-07-01&endDate=2026-07-31"
      )
    );
    const csv = await response.text();
    const rows = csv.split("\n");
    expect(rows[0]?.split(",")).toEqual([...REFERENCE_EXPORT_COLUMNS]);
    expect(rows).toHaveLength(10);
    expect(csv).toContain(`"${fixtures.prefix} Eligible expense"`);
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "TRANSACTION_CREATED"
        }
      })
    ).resolves.toBe(9);
    await expect(
      prisma.activityLog.findFirst({
        where: {
          userId: fixtures.context.userA.id,
          action: "CSV_EXPORTED"
        },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({ rowCount: 9 })
    });
  }, 30_000);

  it("updates every dependent projection after an edit and exact-ID deletes", async () => {
    authState.userId = fixtures.context.userA.id;
    await expectOk(
      updateTransaction(fixtures.bankExpenseId, { amount: "100.00" })
    );

    let [bank, dashboard, reports] = await Promise.all([
      trackedBalance(fixtures.bankId),
      getDashboardData("2026-07-01", "2026-07-31"),
      reportProjection()
    ]);
    expect(bank.toFixed(2)).toBe("1495.00");
    expect(dashboard.summary.totalExpense.toFixed(2)).toBe("400.00");
    expect(dashboard.summary.estimatedNetPosition.toFixed(2)).toBe("2560.00");
    expect(reports.incomeExpense[0]?.expense.toFixed(2)).toBe("310.00");
    expect(reports.projects[0]?.totalExpense.toFixed(2)).toBe("310.00");
    expect(reports.sources.find(({ sourceName }) => sourceName.endsWith("Bank"))?.total.toFixed(2)).toBe(
      "100.00"
    );
    expect(reports.waivers[0]?.state.eligibleSpending.toFixed(2)).toBe("210.00");

    await expectOk(deleteTransaction(fixtures.refundId));
    [bank, dashboard, reports] = await Promise.all([
      trackedBalance(fixtures.bankId),
      getDashboardData("2026-07-01", "2026-07-31"),
      reportProjection()
    ]);
    expect(bank.toFixed(2)).toBe("1405.00");
    expect(dashboard.summary.estimatedNetPosition.toFixed(2)).toBe("2470.00");
    expect(reports.incomeExpense[0]?.expense.toFixed(2)).toBe("400.00");
    expect(reports.projects[0]?.totalExpense.toFixed(2)).toBe("400.00");
    expect(reports.waivers[0]?.state.eligibleSpending.toFixed(2)).toBe("300.00");

    await expectOk(deleteTransaction(fixtures.cardCreditAdjustmentId));
    const [cardRows, finalExport] = await Promise.all([
      loadCreditCardDebtReport({
        ...julyFilters,
        moneySourceId: fixtures.cardId
      }),
      exportTransactions(
        new Request(
          "http://localhost/api/export/transactions?startDate=2026-07-01&endDate=2026-07-31"
        )
      )
    ]);
    expect(cardRows[0]?.state.outstandingDebt.toFixed(2)).toBe("85.00");
    expect(cardRows[0]?.state.cardCredit.toFixed(2)).toBe("0.00");
    expect((await finalExport.text()).split("\n")).toHaveLength(8);
    await expect(
      prisma.activityLog.findFirst({
        where: {
          userId: fixtures.context.userA.id,
          action: "CSV_EXPORTED"
        },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({ rowCount: 7 })
    });
    await expect(
      prisma.transaction.count({
        where: {
          userId: fixtures.context.userA.id,
          id: {
            in: [fixtures.refundId, fixtures.cardCreditAdjustmentId]
          }
        }
      })
    ).resolves.toBe(0);
  }, 30_000);
});
