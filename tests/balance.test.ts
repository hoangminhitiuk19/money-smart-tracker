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
  it("adds decimal cents exactly", () => {
    expect(
      calculateTrackedBalance(
        { id: source.id, openingBalance: "0.10" },
        [
          tx({
            amount: "0.20",
            type: TransactionType.INCOME,
            toMoneySourceId: source.id
          })
        ]
      ).toFixed(2)
    ).toBe("0.30");
  });

  it("preserves cents above Number.MAX_SAFE_INTEGER", () => {
    expect(
      calculateTrackedBalance(
        { id: source.id, openingBalance: "90071992547409.99" },
        [
          tx({
            amount: "0.01",
            type: TransactionType.INCOME,
            toMoneySourceId: source.id
          })
        ]
      ).toFixed(2)
    ).toBe("90071992547410.00");
  });

  it("returns a Decimal that preserves subsequent cent arithmetic", () => {
    expect(
      calculateTrackedBalance(
        { id: source.id, openingBalance: "90071992547409.99" },
        []
      )
        .plus("0.01")
        .toFixed(2)
    ).toBe("90071992547410.00");
  });

  it("income increases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.INCOME, toMoneySourceId: source.id })
      ]).toFixed(2)
    ).toBe("1100.00");
  });

  it("expense decreases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.EXPENSE, fromMoneySourceId: source.id })
      ]).toFixed(2)
    ).toBe("900.00");
  });

  it("transfer in increases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.TRANSFER, toMoneySourceId: source.id })
      ]).toFixed(2)
    ).toBe("1100.00");
  });

  it("transfer out decreases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.TRANSFER, fromMoneySourceId: source.id })
      ]).toFixed(2)
    ).toBe("900.00");
  });

  it("refund increases balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({ type: TransactionType.REFUND, toMoneySourceId: source.id })
      ]).toFixed(2)
    ).toBe("1100.00");
  });

  it("adjustment INCREASE adds to balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({
          type: TransactionType.ADJUSTMENT,
          adjustedMoneySourceId: source.id,
          adjustmentDirection: AdjustmentDirection.INCREASE
        })
      ]).toFixed(2)
    ).toBe("1100.00");
  });

  it("adjustment DECREASE subtracts from balance", () => {
    expect(
      calculateTrackedBalance(source, [
        tx({
          type: TransactionType.ADJUSTMENT,
          adjustedMoneySourceId: source.id,
          adjustmentDirection: AdjustmentDirection.DECREASE
        })
      ]).toFixed(2)
    ).toBe("900.00");
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
      ]).toFixed(2)
    ).toBe("1355.00");
  });

  it("empty transactions returns openingBalance", () => {
    expect(calculateTrackedBalance(source, []).toFixed(2)).toBe("1000.00");
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
      ]).toFixed(2)
    ).toBe("1000.00");
  });
});
