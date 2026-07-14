import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { calculateTrackedBalance } from "@/lib/calc/balance";
import { calculateCreditCardState } from "@/lib/calc/credit-card";

type DecimalLike = {
  toNumber?: () => number;
  toString?: () => string;
};

type RequiredDashboardAmount = number | string | DecimalLike;
type DashboardAmount = RequiredDashboardAmount | null | undefined;

export type DashboardTransaction = {
  id?: string;
  type: TransactionType;
  amount: RequiredDashboardAmount;
  transactionDate: Date | string;
  qualityRating?: QualityRating | null;
  fromMoneySourceId?: string | null;
  toMoneySourceId?: string | null;
  adjustedMoneySourceId?: string | null;
  adjustmentDirection?: AdjustmentDirection | null;
  adjustmentTarget?: AdjustmentTarget | null;
  relatedTransactionId?: string | null;
  countTowardFeeWaiver?: boolean | null;
};

export type DashboardMoneySource = {
  id: string;
  type: MoneySourceType;
  openingBalance: RequiredDashboardAmount;
  creditLimit?: DashboardAmount;
  initialOutstandingDebt?: DashboardAmount;
  initialCardCredit?: DashboardAmount;
};

export type DashboardGoal = {
  id: string;
};

export type DashboardProject = {
  id: string;
};

export type DashboardRenewal = {
  id: string;
};

export type DashboardQualityBucket = {
  count: number;
  amount: number;
};

export type DashboardQualityBreakdown = Record<
  QualityRating,
  DashboardQualityBucket
>;

function toNumber(value: DashboardAmount) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  if (value.toNumber) {
    return value.toNumber();
  }

  return Number(value.toString?.() ?? 0);
}

function emptyQualityBreakdown(): DashboardQualityBreakdown {
  return {
    A: { count: 0, amount: 0 },
    B: { count: 0, amount: 0 },
    C: { count: 0, amount: 0 },
    D: { count: 0, amount: 0 },
    S: { count: 0, amount: 0 }
  };
}

export function calculateNetSavings(transactions: DashboardTransaction[]) {
  const expenseTransactions = transactions.filter(
    (transaction) => transaction.type === TransactionType.EXPENSE
  );
  const totalIncome = transactions.reduce((total, transaction) => {
    return transaction.type === TransactionType.INCOME
      ? total + toNumber(transaction.amount)
      : total;
  }, 0);
  const totalExpense = expenseTransactions.reduce(
    (total, transaction) => total + toNumber(transaction.amount),
    0
  );
  const netSavings = totalIncome - totalExpense;

  return {
    totalIncome,
    totalExpense,
    netSavings,
    savingRate: totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0
  };
}

export function calculateEstimatedNetPosition(
  moneySources: DashboardMoneySource[],
  transactions: DashboardTransaction[]
) {
  const nonCardBalanceTotal = moneySources.reduce((total, source) => {
    if (source.type === MoneySourceType.CREDIT_CARD) {
      return total;
    }

    return total + calculateTrackedBalance(source, transactions);
  }, 0);
  const cardDebtTotal = moneySources.reduce((total, source) => {
    if (source.type !== MoneySourceType.CREDIT_CARD) {
      return total;
    }

    return (
      total +
      calculateCreditCardState(
        {
          id: source.id,
          creditLimit: source.creditLimit,
          initialCardCredit: source.initialCardCredit ?? 0,
          initialOutstandingDebt: source.initialOutstandingDebt ?? 0
        },
        transactions
      ).outstandingDebt
    );
  }, 0);

  return nonCardBalanceTotal - cardDebtTotal;
}

export function getDashboardSummary(
  transactions: DashboardTransaction[],
  goals: DashboardGoal[],
  projects: DashboardProject[],
  moneySources: DashboardMoneySource[],
  renewals: DashboardRenewal[],
  today: Date | string
) {
  void goals;
  void projects;
  void renewals;
  void today;

  const expenseTransactions = transactions.filter(
    (transaction) => transaction.type === TransactionType.EXPENSE
  );
  const { totalIncome, totalExpense, netSavings, savingRate } =
    calculateNetSavings(transactions);
  const qualityBreakdown = expenseTransactions.reduce(
    (breakdown, transaction) => {
      if (!transaction.qualityRating) {
        return breakdown;
      }

      const amount = toNumber(transaction.amount);
      breakdown[transaction.qualityRating].count += 1;
      breakdown[transaction.qualityRating].amount += amount;
      return breakdown;
    },
    emptyQualityBreakdown()
  );
  const ratedAmount = Object.values(qualityBreakdown).reduce(
    (total, bucket) => total + bucket.amount,
    0
  );
  const highQualityAmount =
    qualityBreakdown.S.amount + qualityBreakdown.A.amount;
  const spendingBySource = expenseTransactions.reduce<Record<string, number>>(
    (groups, transaction) => {
      if (!transaction.fromMoneySourceId) {
        return groups;
      }

      groups[transaction.fromMoneySourceId] =
        (groups[transaction.fromMoneySourceId] ?? 0) +
        toNumber(transaction.amount);
      return groups;
    },
    {}
  );

  return {
    totalIncome,
    totalExpense,
    netSavings,
    savingRate,
    qualityBreakdown,
    highQualityPercent:
      ratedAmount > 0 ? (highQualityAmount / ratedAmount) * 100 : 0,
    lowQualityAmount: qualityBreakdown.C.amount + qualityBreakdown.D.amount,
    spendingBySource,
    estimatedNetPosition: calculateEstimatedNetPosition(
      moneySources,
      transactions
    )
  };
}
