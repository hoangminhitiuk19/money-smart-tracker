import {
  AdjustmentDirection,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getCountTowardFeeWaiverDefault,
  validateTransactionFields,
  type TransactionValidationInput
} from "@/lib/calc/transactions";

const baseTransaction: TransactionValidationInput = {
  amount: 100,
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
    expect(validate({ amount: 0 }).ok).toBe(false);
    expect(validate({ amount: -1 }).ok).toBe(false);
  });

  it("countTowardFeeWaiver pre-fills true for credit card expense", () => {
    expect(
      getCountTowardFeeWaiverDefault(
        {
          type: TransactionType.EXPENSE,
          fromMoneySourceId: "card-1"
        },
        [{ id: "card-1", type: MoneySourceType.CREDIT_CARD }]
      )
    ).toBe(true);
  });

  it("countTowardFeeWaiver stays false for TRANSFER", () => {
    expect(
      getCountTowardFeeWaiverDefault(
        {
          type: TransactionType.TRANSFER,
          fromMoneySourceId: "card-1"
        },
        [{ id: "card-1", type: MoneySourceType.CREDIT_CARD }]
      )
    ).toBe(false);
  });
});
