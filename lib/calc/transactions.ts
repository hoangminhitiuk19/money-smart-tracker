import {
  AdjustmentDirection,
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";

export type TransactionValidationInput = {
  type: TransactionType;
  amount: number;
  fromMoneySourceId?: string | null;
  toMoneySourceId?: string | null;
  adjustedMoneySourceId?: string | null;
  adjustmentDirection?: AdjustmentDirection | null;
  qualityRating?: QualityRating | null;
};

export type FeeWaiverSource = {
  id: string;
  type: MoneySourceType;
};

export function validateTransactionFields(input: TransactionValidationInput) {
  const errors: string[] = [];

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    errors.push("Amount must be positive.");
  }

  if (input.type === TransactionType.INCOME) {
    if (input.fromMoneySourceId) {
      errors.push("Income cannot have a from money source.");
    }

    if (!input.toMoneySourceId) {
      errors.push("Income requires a to money source.");
    }
  }

  if (input.type === TransactionType.EXPENSE) {
    if (!input.fromMoneySourceId) {
      errors.push("Expense requires a from money source.");
    }

    if (input.toMoneySourceId) {
      errors.push("Expense cannot have a to money source.");
    }
  }

  if (input.type === TransactionType.TRANSFER) {
    if (!input.fromMoneySourceId || !input.toMoneySourceId) {
      errors.push("Transfer requires both money sources.");
    }

    if (
      input.fromMoneySourceId &&
      input.toMoneySourceId &&
      input.fromMoneySourceId === input.toMoneySourceId
    ) {
      errors.push("Transfer money sources must be different.");
    }
  }

  if (input.type === TransactionType.REFUND) {
    if (input.fromMoneySourceId) {
      errors.push("Refund cannot have a from money source.");
    }

    if (!input.toMoneySourceId) {
      errors.push("Refund requires a to money source.");
    }
  }

  if (input.type === TransactionType.ADJUSTMENT) {
    if (input.fromMoneySourceId || input.toMoneySourceId) {
      errors.push("Adjustment cannot have from or to money sources.");
    }

    if (!input.adjustedMoneySourceId) {
      errors.push("Adjustment requires an adjusted money source.");
    }

    if (!input.adjustmentDirection) {
      errors.push("Adjustment requires an adjustment direction.");
    }
  }

  if (input.type !== TransactionType.EXPENSE && input.qualityRating) {
    errors.push("Quality rating is only valid for expenses.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function adjustmentDirectionEffect(
  amount: number,
  direction: AdjustmentDirection
) {
  return direction === AdjustmentDirection.INCREASE ? amount : -amount;
}

export function getCountTowardFeeWaiverDefault(
  input: Pick<TransactionValidationInput, "type" | "fromMoneySourceId">,
  moneySources: FeeWaiverSource[]
) {
  if (input.type !== TransactionType.EXPENSE || !input.fromMoneySourceId) {
    return false;
  }

  const source = moneySources.find(
    (moneySource) => moneySource.id === input.fromMoneySourceId
  );

  return source?.type === MoneySourceType.CREDIT_CARD;
}
