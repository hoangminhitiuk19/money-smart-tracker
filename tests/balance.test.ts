import {
  AdjustmentDirection,
  TransactionType
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateTrackedBalance,
  type BalanceSource,
  type BalanceTransaction
} from "@/lib/calc/balance";

const source: BalanceSource = {
  id: "source-1",
  openingBalance: 1000
};

function tx(transaction: Partial<BalanceTransaction>): BalanceTransaction {
  return {
    amount: 100,
    type: TransactionType.EXPENSE,
    ...transaction
  };
}

describe("calculateTrackedBalance", () => {
  it("income increases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.INCOME, toMoneySourceId: source.id })
      ])
    ).toBe(1100);
  });

  it("expense decreases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.EXPENSE, fromMoneySourceId: source.id })
      ])
    ).toBe(900);
  });

  it("transfer in increases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.TRANSFER, toMoneySourceId: source.id })
      ])
    ).toBe(1100);
  });

  it("transfer out decreases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.TRANSFER, fromMoneySourceId: source.id })
      ])
    ).toBe(900);
  });

  it("refund increases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.REFUND, toMoneySourceId: source.id })
      ])
    ).toBe(1100);
  });

  it("adjustment INCREASE adds to balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({
          type: TransactionType.ADJUSTMENT,
          adjustedMoneySourceId: source.id,
          adjustmentDirection: AdjustmentDirection.INCREASE
        })
      ])
    ).toBe(1100);
  });

  it("adjustment DECREASE subtracts from balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({
          type: TransactionType.ADJUSTMENT,
          adjustedMoneySourceId: source.id,
          adjustmentDirection: AdjustmentDirection.DECREASE
        })
      ])
    ).toBe(900);
  });

  it("combines multiple transaction types", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ amount: 500, type: TransactionType.INCOME, toMoneySourceId: source.id }),
        tx({ amount: 200, type: TransactionType.EXPENSE, fromMoneySourceId: source.id }),
        tx({ amount: 75, type: TransactionType.TRANSFER, toMoneySourceId: source.id }),
        tx({ amount: 50, type: TransactionType.TRANSFER, fromMoneySourceId: source.id }),
        tx({ amount: 25, type: TransactionType.REFUND, toMoneySourceId: source.id }),
        tx({
          amount: 10,
          type: TransactionType.ADJUSTMENT,
          adjustedMoneySourceId: source.id,
          adjustmentDirection: AdjustmentDirection.INCREASE
        }),
        tx({
          amount: 5,
          type: TransactionType.ADJUSTMENT,
          adjustedMoneySourceId: source.id,
          adjustmentDirection: AdjustmentDirection.DECREASE
        })
      ])
    ).toBe(1355);
  });

  it("empty transactions returns openingBalance", () => {
    expect(calculateTrackedBalance(source, [])).toBe(1000);
  });

  it("nets a self-transfer to zero instead of double-counting it", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({
          amount: 100,
          type: TransactionType.TRANSFER,
          fromMoneySourceId: source.id,
          toMoneySourceId: source.id
        })
      ])
    ).toBe(1000);
  });
});
