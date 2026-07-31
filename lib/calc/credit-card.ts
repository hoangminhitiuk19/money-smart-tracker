import {
  AdjustmentDirection,
  AdjustmentTarget,
  TransactionType
} from "@prisma/client";
import { exclusiveDayAfter, startOfDate } from "@/lib/date-range";
import { decimal, percent, type DecimalInput } from "@/lib/money";

type CreditCardAmount = DecimalInput | null | undefined;

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
  id: string;
  createdAt: Date | string;
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

function amount(value: CreditCardAmount) {
  return decimal(value ?? 0);
}

function dateValue(date: Date | string) {
  return new Date(date).getTime();
}

function storedDateOnlyValue(date: Date | string) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  return new Date(date).toISOString().slice(0, 10);
}

function isWithinWaiverPeriod(
  transactionDate: Date | string,
  source: CreditCardSource
) {
  const value = dateValue(transactionDate);
  const start = source.waiverPeriodStartDate
    ? startOfDate(storedDateOnlyValue(source.waiverPeriodStartDate)).getTime()
    : null;
  const exclusiveEnd = source.waiverPeriodEndDate
    ? exclusiveDayAfter(
        storedDateOnlyValue(source.waiverPeriodEndDate)
      ).getTime()
    : null;

  return (
    (start === null || value >= start) &&
    (exclusiveEnd === null || value < exclusiveEnd)
  );
}

export function calculateCreditCardState(
  source: CreditCardSource,
  transactions: CreditCardTransaction[]
) {
  let debt = amount(source.initialOutstandingDebt);
  let cardCredit = amount(source.initialCardCredit);

  const chronologicalTransactions = [...transactions].sort((a, b) => {
    const transactionDateDifference =
      dateValue(a.transactionDate) - dateValue(b.transactionDate);

    if (transactionDateDifference !== 0) {
      return transactionDateDifference;
    }

    const createdAtDifference = dateValue(a.createdAt) - dateValue(b.createdAt);

    if (createdAtDifference !== 0) {
      return createdAtDifference;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  for (const transaction of chronologicalTransactions) {
    const transactionAmount = amount(transaction.amount);

    if (
      transaction.type === TransactionType.EXPENSE &&
      transaction.fromMoneySourceId === source.id
    ) {
      if (cardCredit.gt(0) && transactionAmount.lte(cardCredit)) {
        cardCredit = cardCredit.minus(transactionAmount);
      } else if (cardCredit.gt(0) && transactionAmount.gt(cardCredit)) {
        debt = debt.plus(transactionAmount.minus(cardCredit));
        cardCredit = decimal(0);
      } else {
        debt = debt.plus(transactionAmount);
      }
    }

    if (
      transaction.type === TransactionType.TRANSFER &&
      transaction.toMoneySourceId === source.id
    ) {
      if (transactionAmount.lte(debt)) {
        debt = debt.minus(transactionAmount);
      } else {
        cardCredit = cardCredit.plus(transactionAmount.minus(debt));
        debt = decimal(0);
      }
    }

    if (
      transaction.type === TransactionType.REFUND &&
      transaction.toMoneySourceId === source.id
    ) {
      if (debt.gt(0) && transactionAmount.lte(debt)) {
        debt = debt.minus(transactionAmount);
      } else if (debt.gt(0) && transactionAmount.gt(debt)) {
        cardCredit = cardCredit.plus(transactionAmount.minus(debt));
        debt = decimal(0);
      } else {
        cardCredit = cardCredit.plus(transactionAmount);
      }
    }

    if (
      transaction.type === TransactionType.ADJUSTMENT &&
      transaction.adjustedMoneySourceId === source.id
    ) {
      if (transaction.adjustmentTarget === AdjustmentTarget.CREDIT_CARD_DEBT) {
        debt =
          transaction.adjustmentDirection === AdjustmentDirection.INCREASE
            ? debt.plus(transactionAmount)
            : debt.minus(transactionAmount);
      }

      if (transaction.adjustmentTarget === AdjustmentTarget.CARD_CREDIT) {
        cardCredit =
          transaction.adjustmentDirection === AdjustmentDirection.INCREASE
            ? cardCredit.plus(transactionAmount)
            : cardCredit.minus(transactionAmount);
      }
    }
  }

  return {
    outstandingDebt: debt,
    availableCredit: amount(source.creditLimit).minus(debt).gt(0)
      ? amount(source.creditLimit).minus(debt)
      : decimal(0),
    cardCredit
  };
}

export function calculateFeeWaiverState(
  source: CreditCardSource,
  transactions: CreditCardTransaction[]
) {
  const spendTarget = amount(source.annualFeeWaiverSpendTarget);

  if (spendTarget.isZero()) {
    return {
      eligibleSpending: decimal(0),
      progress: decimal(0),
      remaining: decimal(0)
    };
  }

  const eligibleExpenses = new Map<string, CreditCardTransaction>();
  const eligibleExpenseTotal = transactions.reduce((total, transaction) => {
    const isEligibleExpense =
      transaction.type === TransactionType.EXPENSE &&
      transaction.fromMoneySourceId === source.id &&
      transaction.countTowardFeeWaiver === true &&
      isWithinWaiverPeriod(transaction.transactionDate, source);

    if (!isEligibleExpense) {
      return total;
    }

    eligibleExpenses.set(transaction.id, transaction);

    return total.plus(amount(transaction.amount));
  }, decimal(0));

  const linkedRefundTotal = transactions.reduce((total, transaction) => {
    const isLinkedRefund =
      transaction.type === TransactionType.REFUND &&
      transaction.relatedTransactionId !== null &&
      transaction.relatedTransactionId !== undefined &&
      eligibleExpenses.has(transaction.relatedTransactionId);

    return isLinkedRefund ? total.plus(amount(transaction.amount)) : total;
  }, decimal(0));

  const eligibleSpending = eligibleExpenseTotal.minus(linkedRefundTotal);
  const remaining = spendTarget.minus(eligibleSpending);

  return {
    eligibleSpending,
    progress: percent(eligibleSpending, spendTarget),
    remaining: remaining.gt(0) ? remaining : decimal(0)
  };
}
