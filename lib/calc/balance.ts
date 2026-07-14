import { AdjustmentDirection, TransactionType } from "@prisma/client";

type DecimalLike = {
  toNumber?: () => number;
  toString?: () => string;
};

type BalanceAmount = number | string | DecimalLike;

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

function toNumber(value: BalanceAmount) {
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

export function calculateTrackedBalance(
  source: BalanceSource,
  transactions: BalanceTransaction[]
) {
  return transactions.reduce((balance, transaction) => {
    const amount = toNumber(transaction.amount);
    let next = balance;

    if (
      (transaction.type === TransactionType.INCOME ||
        transaction.type === TransactionType.TRANSFER ||
        transaction.type === TransactionType.REFUND) &&
      transaction.toMoneySourceId === source.id
    ) {
      next += amount;
    }

    if (
      (transaction.type === TransactionType.EXPENSE ||
        transaction.type === TransactionType.TRANSFER) &&
      transaction.fromMoneySourceId === source.id
    ) {
      next -= amount;
    }

    if (
      transaction.type === TransactionType.ADJUSTMENT &&
      transaction.adjustedMoneySourceId === source.id
    ) {
      next +=
        transaction.adjustmentDirection === AdjustmentDirection.INCREASE
          ? amount
          : -amount;
    }

    return next;
  }, toNumber(source.openingBalance));
}
