import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getCountTowardFeeWaiverDefault,
  validateTransactionFields,
  type TransactionValidationInput
} from "@/lib/calc/transactions";

const baseTransaction: TransactionValidationInput = {
  amount: "100.00",
  type: TransactionType.EXPENSE,
  fromMoneySourceId: "source-1"
};

function validate(transaction: Partial<TransactionValidationInput>) {
  return validateTransactionFields({
    ...baseTransaction,
    ...transaction
  });
}

describe("transaction validation", () => {
  it("INCOME rejects fromMoneySourceId", () => {
    expect(
      validate({
        type: TransactionType.INCOME,
        fromMoneySourceId: "source-1",
        toMoneySourceId: "source-2"
      }).ok
    ).toBe(false);
  });

  it("INCOME requires toMoneySourceId", () => {
    expect(
      validate({
        type: TransactionType.INCOME,
        fromMoneySourceId: null,
        toMoneySourceId: null
      }).ok
    ).toBe(false);
  });

  it("EXPENSE requires fromMoneySourceId", () => {
    expect(
      validate({
        type: TransactionType.EXPENSE,
        fromMoneySourceId: null
      }).ok
    ).toBe(false);
  });

  it("EXPENSE rejects toMoneySourceId", () => {
    expect(
      validate({
        type: TransactionType.EXPENSE,
        fromMoneySourceId: "source-1",
        toMoneySourceId: "source-2"
      }).ok
    ).toBe(false);
  });

  it("TRANSFER requires both and rejects when same ID", () => {
    expect(
      validate({
        type: TransactionType.TRANSFER,
        fromMoneySourceId: "source-1",
        toMoneySourceId: null
      }).ok
    ).toBe(false);

    expect(
      validate({
        type: TransactionType.TRANSFER,
        fromMoneySourceId: "source-1",
        toMoneySourceId: "source-1"
      }).ok
    ).toBe(false);
  });

  it("REFUND requires toMoneySourceId", () => {
    expect(
      validate({
        type: TransactionType.REFUND,
        fromMoneySourceId: null,
        toMoneySourceId: null
      }).ok
    ).toBe(false);
  });

  it("ADJUSTMENT requires adjustedMoneySourceId and adjustmentDirection", () => {
    expect(
      validate({
        type: TransactionType.ADJUSTMENT,
        fromMoneySourceId: null,
        toMoneySourceId: null,
        adjustedMoneySourceId: null,
        adjustmentDirection: null
      }).ok
    ).toBe(false);

    expect(
      validate({
        type: TransactionType.ADJUSTMENT,
        fromMoneySourceId: null,
        toMoneySourceId: null,
        adjustedMoneySourceId: "source-1",
        adjustmentDirection: AdjustmentDirection.INCREASE
      }).ok
    ).toBe(true);
  });

  it("amount must be positive", () => {
    expect(validate({ amount: "0" }).ok).toBe(false);
    expect(validate({ amount: "-1" }).ok).toBe(false);
  });

  it("accepts an exact positive Decimal(18,2) value without Number coercion", () => {
    expect(validate({ amount: "90071992547409.99" }).ok).toBe(true);
  });

  it.each(["NaN", "Infinity", "0.001", "99999999999999999.99"])(
    "rejects an invalid Decimal(18,2) value: %s",
    (amount) => {
      expect(validate({ amount }).ok).toBe(false);
    }
  );

  it("allows an optional REFUND link", () => {
    expect(
      validate({
        type: TransactionType.REFUND,
        fromMoneySourceId: null,
        toMoneySourceId: "bank",
        relatedTransactionId: "expense"
      }).ok
    ).toBe(true);
  });

  it("rejects a refund link on every non-REFUND transaction type", () => {
    const validByType: Record<
      Exclude<TransactionType, "REFUND">,
      Partial<TransactionValidationInput>
    > = {
      [TransactionType.INCOME]: {
        fromMoneySourceId: null,
        toMoneySourceId: "bank"
      },
      [TransactionType.EXPENSE]: {
        fromMoneySourceId: "bank",
        toMoneySourceId: null
      },
      [TransactionType.TRANSFER]: {
        fromMoneySourceId: "bank",
        toMoneySourceId: "wallet"
      },
      [TransactionType.ADJUSTMENT]: {
        fromMoneySourceId: null,
        toMoneySourceId: null,
        adjustedMoneySourceId: "bank",
        adjustedMoneySourceType: MoneySourceType.BANK_ACCOUNT,
        adjustmentDirection: AdjustmentDirection.INCREASE
      }
    };

    for (const type of [
      TransactionType.INCOME,
      TransactionType.EXPENSE,
      TransactionType.TRANSFER,
      TransactionType.ADJUSTMENT
    ] as const) {
      expect(
        validate({
          type,
          ...validByType[type],
          relatedTransactionId: "expense"
        }).ok
      ).toBe(false);
    }
  });

  it("accepts a card ADJUSTMENT without a target so it can default to debt", () => {
    expect(
      validate({
        type: TransactionType.ADJUSTMENT,
        fromMoneySourceId: null,
        toMoneySourceId: null,
        adjustedMoneySourceId: "card",
        adjustedMoneySourceType: MoneySourceType.CREDIT_CARD,
        adjustmentDirection: AdjustmentDirection.INCREASE,
        adjustmentTarget: null
      }).ok
    ).toBe(true);
  });

  it("accepts both card adjustment targets", () => {
    for (const adjustmentTarget of Object.values(AdjustmentTarget)) {
      expect(
        validate({
          type: TransactionType.ADJUSTMENT,
          fromMoneySourceId: null,
          toMoneySourceId: null,
          adjustedMoneySourceId: "card",
          adjustedMoneySourceType: MoneySourceType.CREDIT_CARD,
          adjustmentDirection: AdjustmentDirection.INCREASE,
          adjustmentTarget
        }).ok
      ).toBe(true);
    }
  });

  it("rejects an adjustment target for a non-card source", () => {
    expect(
      validate({
        type: TransactionType.ADJUSTMENT,
        fromMoneySourceId: null,
        toMoneySourceId: null,
        adjustedMoneySourceId: "bank",
        adjustedMoneySourceType: MoneySourceType.BANK_ACCOUNT,
        adjustmentDirection: AdjustmentDirection.INCREASE,
        adjustmentTarget: AdjustmentTarget.CARD_CREDIT
      }).ok
    ).toBe(false);
  });

  it("rejects adjustment-only fields on non-adjustments", () => {
    expect(
      validate({
        type: TransactionType.EXPENSE,
        adjustedMoneySourceId: "source-1",
        adjustedMoneySourceType: MoneySourceType.BANK_ACCOUNT,
        adjustmentDirection: AdjustmentDirection.INCREASE,
        adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT
      }).ok
    ).toBe(false);
  });

  it("rejects quality ratings on every non-EXPENSE type", () => {
    expect(
      validate({
        type: TransactionType.INCOME,
        fromMoneySourceId: null,
        toMoneySourceId: "bank",
        qualityRating: QualityRating.A
      }).ok
    ).toBe(false);
  });

  it("countTowardFeeWaiver pre-fills true for credit card expense", () => {
    expect(
      getCountTowardFeeWaiverDefault(
        {
          type: TransactionType.EXPENSE,
          fromMoneySourceId: "card-1"
        },
        [{ id: "card-1", type: MoneySourceType.CREDIT_CARD }],
        { defaultCountTowardFeeWaiver: true }
      )
    ).toBe(true);
  });

  it("countTowardFeeWaiver uses the selected category exclusion", () => {
    expect(
      getCountTowardFeeWaiverDefault(
        {
          type: TransactionType.EXPENSE,
          fromMoneySourceId: "card-1"
        },
        [{ id: "card-1", type: MoneySourceType.CREDIT_CARD }],
        { defaultCountTowardFeeWaiver: false }
      )
    ).toBe(false);
  });

  it("countTowardFeeWaiver stays false for TRANSFER", () => {
    expect(
      getCountTowardFeeWaiverDefault(
        {
          type: TransactionType.TRANSFER,
          fromMoneySourceId: "card-1"
        },
        [{ id: "card-1", type: MoneySourceType.CREDIT_CARD }],
        { defaultCountTowardFeeWaiver: true }
      )
    ).toBe(false);
  });
});
