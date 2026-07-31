import { AdjustmentDirection, TransactionType } from "@prisma/client";
import { decimal, type DecimalInput } from "@/lib/money";

type BalanceAmount = DecimalInput;

export type BalanceSource = {
  id: string;
  openingBalance: BalanceAmount;
};

export type BalanceTransaction = {
  type: TransactionType;
  amount: BalanceAmount;
  fromMoneySourceId?: string | null;
  toMoneySourceId?: string | null;
  adjustedMoneySourceId?: string | null;
  adjustmentDirection?: AdjustmentDirection | null;
};

export function calculateTrackedBalance(
  source: BalanceSource,
  transactions: BalanceTransaction[]
) {
  return transactions.reduce((balance, transaction) => {
    const amount = decimal(transaction.amount);
    let next = balance;

    if (
      (transaction.type === TransactionType.INCOME ||
        transaction.type === TransactionType.TRANSFER ||
        transaction.type === TransactionType.REFUND) &&
      transaction.toMoneySourceId === source.id
    ) {
      next = next.plus(amount);
    }

    if (
      (transaction.type === TransactionType.EXPENSE ||
        transaction.type === TransactionType.TRANSFER) &&
      transaction.fromMoneySourceId === source.id
    ) {
      next = next.minus(amount);
    }

    if (
      transaction.type === TransactionType.ADJUSTMENT &&
      transaction.adjustedMoneySourceId === source.id
    ) {
      next =
        transaction.adjustmentDirection === AdjustmentDirection.INCREASE
          ? next.plus(amount)
          : next.minus(amount);
    }

    return next;
  }, decimal(source.openingBalance));
}
