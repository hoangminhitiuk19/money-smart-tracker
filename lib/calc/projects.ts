import { TransactionType } from "@prisma/client";
import { decimal, percent, type DecimalInput } from "@/lib/money";

type ProjectAmount = DecimalInput;

export type ProjectSummaryTransaction = {
  type: TransactionType;
  amount: ProjectAmount;
  projectId?: string | null;
};

export function calculateProjectSummary(
  transactions: ProjectSummaryTransaction[]
) {
  const totals = transactions.reduce(
    (summary, transaction) => {
      if (transaction.type === TransactionType.INCOME) {
        return {
          ...summary,
          totalIncome: summary.totalIncome.plus(decimal(transaction.amount))
        };
      }

      if (transaction.type === TransactionType.EXPENSE) {
        return {
          ...summary,
          totalExpense: summary.totalExpense.plus(decimal(transaction.amount))
        };
      }

      return summary;
    },
    {
      totalIncome: decimal(0),
      totalExpense: decimal(0)
    }
  );

  const profit = totals.totalIncome.minus(totals.totalExpense);
  const roi =
    totals.totalExpense.gt(0) ? percent(profit, totals.totalExpense) : null;

  return {
    ...totals,
    profit,
    roi
  };
}
