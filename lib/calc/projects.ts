import { TransactionType } from "@prisma/client";

type DecimalLike = {
  toNumber?: () => number;
  toString?: () => string;
};

type ProjectAmount = number | string | DecimalLike;

export type ProjectSummaryTransaction = {
  type: TransactionType;
  amount: ProjectAmount;
  projectId?: string | null;
};

function toNumber(value: ProjectAmount) {
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

export function calculateProjectSummary(
  transactions: ProjectSummaryTransaction[]
) {
  const totals = transactions.reduce(
    (summary, transaction) => {
      if (transaction.type === TransactionType.INCOME) {
        return {
          ...summary,
          totalIncome: summary.totalIncome + toNumber(transaction.amount)
        };
      }

      if (transaction.type === TransactionType.EXPENSE) {
        return {
          ...summary,
          totalExpense: summary.totalExpense + toNumber(transaction.amount)
        };
      }

      return summary;
    },
    {
      totalIncome: 0,
      totalExpense: 0
    }
  );

  const profit = totals.totalIncome - totals.totalExpense;
  const roi =
    totals.totalExpense > 0 ? (profit / totals.totalExpense) * 100 : null;

  return {
    ...totals,
    profit,
    roi
  };
}
