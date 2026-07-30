import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  Prisma,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { calculateTrackedBalance } from "@/lib/calc/balance";
import { calculateCreditCardState } from "@/lib/calc/credit-card";
import { decimal, percent, type DecimalInput } from "@/lib/money";

type RequiredDashboardAmount = DecimalInput;
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
  amount: Prisma.Decimal;
};

export type DashboardQualityBreakdown = Record<
  QualityRating,
  DashboardQualityBucket
>;

function emptyQualityBreakdown(): DashboardQualityBreakdown {
  return {
    A: { count: 0, amount: decimal(0) },
    B: { count: 0, amount: decimal(0) },
    C: { count: 0, amount: decimal(0) },
    D: { count: 0, amount: decimal(0) },
    S: { count: 0, amount: decimal(0) }
  };
}

export function calculateNetSavings(transactions: DashboardTransaction[]) {
  const expenseTransactions = transactions.filter(
    (transaction) => transaction.type === TransactionType.EXPENSE
  );
  const totalIncome = transactions.reduce((total, transaction) => {
    return transaction.type === TransactionType.INCOME
      ? total.plus(decimal(transaction.amount))
      : total;
  }, decimal(0));
  const totalExpense = expenseTransactions.reduce(
    (total, transaction) => total.plus(decimal(transaction.amount)),
    decimal(0)
  );
  const netSavings = totalIncome.minus(totalExpense);

  return {
    totalIncome,
    totalExpense,
    netSavings,
    savingRate: totalIncome.gt(0) ? percent(netSavings, totalIncome) : decimal(0)
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

    return total.plus(calculateTrackedBalance(source, transactions));
  }, decimal(0));
  const cardDebtTotal = moneySources.reduce((total, source) => {
    if (source.type !== MoneySourceType.CREDIT_CARD) {
      return total;
    }

    return total.plus(
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
  }, decimal(0));

  return nonCardBalanceTotal.minus(cardDebtTotal);
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

      const amount = decimal(transaction.amount);
      breakdown[transaction.qualityRating].count += 1;
      breakdown[transaction.qualityRating].amount =
        breakdown[transaction.qualityRating].amount.plus(amount);
      return breakdown;
    },
    emptyQualityBreakdown()
  );
  const ratedAmount = Object.values(qualityBreakdown).reduce(
    (total, bucket) => total.plus(bucket.amount),
    decimal(0)
  );
  const highQualityAmount = qualityBreakdown.S.amount.plus(
    qualityBreakdown.A.amount
  );
  const spendingBySource = expenseTransactions.reduce<
    Record<string, Prisma.Decimal>
  >(
    (groups, transaction) => {
      if (!transaction.fromMoneySourceId) {
        return groups;
      }

      groups[transaction.fromMoneySourceId] =
        (groups[transaction.fromMoneySourceId] ?? decimal(0)).plus(
          decimal(transaction.amount)
        );
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
      ratedAmount.gt(0) ? percent(highQualityAmount, ratedAmount) : decimal(0),
    lowQualityAmount: qualityBreakdown.C.amount.plus(
      qualityBreakdown.D.amount
    ),
    spendingBySource,
    estimatedNetPosition: calculateEstimatedNetPosition(
      moneySources,
      transactions
    )
  };
}
