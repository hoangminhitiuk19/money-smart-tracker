import {
  AdjustmentDirection,
  AdjustmentTarget,
  TransactionType
} from "@prisma/client";

type DecimalLike = {
  toNumber?: () => number;
  toString?: () => string;
};

type CreditCardAmount = number | string | DecimalLike | null | undefined;

export type CreditCardSource = {
  id: string;
  creditLimit?: CreditCardAmount;
  initialOutstandingDebt: CreditCardAmount;
  initialCardCredit: CreditCardAmount;
  annualFeeWaiverSpendTarget?: CreditCardAmount;
  waiverPeriodStartDate?: Date | string | null;
  waiverPeriodEndDate?: Date | string | null;
};

export type CreditCardTransaction = {
  id?: string;
  type: TransactionType;
  amount: CreditCardAmount;
  transactionDate: Date | string;
  fromMoneySourceId?: string | null;
  toMoneySourceId?: string | null;
  adjustedMoneySourceId?: string | null;
  adjustmentDirection?: AdjustmentDirection | null;
  adjustmentTarget?: AdjustmentTarget | null;
  relatedTransactionId?: string | null;
  countTowardFeeWaiver?: boolean | null;
};

function toNumber(value: CreditCardAmount) {
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

function dateValue(date: Date | string) {
  return new Date(date).getTime();
}

function isWithinWaiverPeriod(
  transactionDate: Date | string,
  source: CreditCardSource
) {
  const value = dateValue(transactionDate);
  const start = source.waiverPeriodStartDate
    ? dateValue(source.waiverPeriodStartDate)
    : null;
  const end = source.waiverPeriodEndDate
    ? dateValue(source.waiverPeriodEndDate)
    : null;

  return (start === null || value >= start) && (end === null || value <= end);
}

export function calculateCreditCardState(
  source: CreditCardSource,
  transactions: CreditCardTransaction[]
) {
  let debt = toNumber(source.initialOutstandingDebt);
  let cardCredit = toNumber(source.initialCardCredit);

  const chronologicalTransactions = transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((a, b) => {
      const difference =
        dateValue(a.transaction.transactionDate) -
        dateValue(b.transaction.transactionDate);

      return difference === 0 ? a.index - b.index : difference;
    })
    .map(({ transaction }) => transaction);

  for (const transaction of chronologicalTransactions) {
    const amount = toNumber(transaction.amount);

    if (
      transaction.type === TransactionType.EXPENSE &&
      transaction.fromMoneySourceId === source.id
    ) {
      if (cardCredit > 0 && amount <= cardCredit) {
        cardCredit -= amount;
      } else if (cardCredit > 0 && amount > cardCredit) {
        debt += amount - cardCredit;
        cardCredit = 0;
      } else {
        debt += amount;
      }
    }

    if (
      transaction.type === TransactionType.TRANSFER &&
      transaction.toMoneySourceId === source.id
    ) {
      if (amount <= debt) {
        debt -= amount;
      } else {
        cardCredit += amount - debt;
        debt = 0;
      }
    }

    if (
      transaction.type === TransactionType.REFUND &&
      transaction.toMoneySourceId === source.id
    ) {
      if (debt > 0 && amount <= debt) {
        debt -= amount;
      } else if (debt > 0 && amount > debt) {
        cardCredit += amount - debt;
        debt = 0;
      } else {
        cardCredit += amount;
      }
    }

    if (
      transaction.type === TransactionType.ADJUSTMENT &&
      transaction.adjustedMoneySourceId === source.id
    ) {
      if (transaction.adjustmentTarget === AdjustmentTarget.CREDIT_CARD_DEBT) {
        debt =
          transaction.adjustmentDirection === AdjustmentDirection.INCREASE
            ? debt + amount
            : debt - amount;
      }

      if (transaction.adjustmentTarget === AdjustmentTarget.CARD_CREDIT) {
        cardCredit =
          transaction.adjustmentDirection === AdjustmentDirection.INCREASE
            ? cardCredit + amount
            : cardCredit - amount;
      }
    }
  }

  return {
    outstandingDebt: debt,
    availableCredit: Math.max(0, toNumber(source.creditLimit) - debt),
    cardCredit
  };
}

export function calculateFeeWaiverState(
  source: CreditCardSource,
  transactions: CreditCardTransaction[]
) {
  const spendTarget = toNumber(source.annualFeeWaiverSpendTarget);

  if (spendTarget === 0) {
    return {
      eligibleSpending: 0,
      progress: 0,
      remaining: 0
    };
  }

  const eligibleExpenseIds = new Set<string>();
  const eligibleExpenseTotal = transactions.reduce((total, transaction) => {
    const isEligibleExpense =
      transaction.type === TransactionType.EXPENSE &&
      transaction.fromMoneySourceId === source.id &&
      transaction.countTowardFeeWaiver === true &&
      isWithinWaiverPeriod(transaction.transactionDate, source);

    if (!isEligibleExpense) {
      return total;
    }

    if (transaction.id) {
      eligibleExpenseIds.add(transaction.id);
    }

    return total + toNumber(transaction.amount);
  }, 0);

  const linkedRefundTotal = transactions.reduce((total, transaction) => {
    const isLinkedRefund =
      transaction.type === TransactionType.REFUND &&
      transaction.toMoneySourceId === source.id &&
      transaction.relatedTransactionId !== null &&
      transaction.relatedTransactionId !== undefined &&
      eligibleExpenseIds.has(transaction.relatedTransactionId);

    return isLinkedRefund ? total + toNumber(transaction.amount) : total;
  }, 0);

  const eligibleSpending = eligibleExpenseTotal - linkedRefundTotal;

  return {
    eligibleSpending,
    progress: (eligibleSpending / spendTarget) * 100,
    remaining: Math.max(0, spendTarget - eligibleSpending)
  };
}
