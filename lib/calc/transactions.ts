import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  Prisma,
  QualityRating,
  TransactionType
} from "@prisma/client";

export type TransactionValidationInput = {
  type: TransactionType;
  amount: Prisma.Decimal.Value;
  fromMoneySourceId?: string | null;
  toMoneySourceId?: string | null;
  adjustedMoneySourceId?: string | null;
  adjustedMoneySourceType?: MoneySourceType | null;
  adjustmentDirection?: AdjustmentDirection | null;
  adjustmentTarget?: AdjustmentTarget | null;
  qualityRating?: QualityRating | null;
  relatedTransactionId?: string | null;
};

export type FeeWaiverSource = {
  id: string;
  type: MoneySourceType;
};

export type FeeWaiverCategory = {
  defaultCountTowardFeeWaiver: boolean;
};

const maxDecimal18WithScale2 = new Prisma.Decimal("9999999999999999.99");

function isPositiveDecimal18WithScale2(value: Prisma.Decimal.Value) {
  try {
    const amount = new Prisma.Decimal(value);

    return (
      amount.isFinite() &&
      amount.greaterThan(0) &&
      amount.decimalPlaces() <= 2 &&
      amount.lessThanOrEqualTo(maxDecimal18WithScale2)
    );
  } catch {
    return false;
  }
}

export function validateTransactionFields(input: TransactionValidationInput) {
  const errors: string[] = [];

  if (!isPositiveDecimal18WithScale2(input.amount)) {
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

    if (
      input.adjustedMoneySourceType !== undefined &&
      input.adjustedMoneySourceType !== null &&
      input.adjustedMoneySourceType !== MoneySourceType.CREDIT_CARD &&
      input.adjustmentTarget
    ) {
      errors.push("Adjustment target is only valid for credit cards.");
    }
  } else if (
    input.adjustedMoneySourceId ||
    input.adjustmentDirection ||
    input.adjustmentTarget
  ) {
    errors.push("Adjustment fields are only valid for adjustments.");
  }

  if (input.type !== TransactionType.EXPENSE && input.qualityRating) {
    errors.push("Quality rating is only valid for expenses.");
  }

  if (input.type !== TransactionType.REFUND && input.relatedTransactionId) {
    errors.push("Related transaction is only valid for refunds.");
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
  moneySources: FeeWaiverSource[],
  category?: FeeWaiverCategory | null
) {
  if (input.type !== TransactionType.EXPENSE || !input.fromMoneySourceId) {
    return false;
  }

  const source = moneySources.find(
    (moneySource) => moneySource.id === input.fromMoneySourceId
  );

  return (
    source?.type === MoneySourceType.CREDIT_CARD &&
    category?.defaultCountTowardFeeWaiver !== false
  );
}
