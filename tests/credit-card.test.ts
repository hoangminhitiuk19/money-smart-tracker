import { TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateCreditCardState,
  calculateFeeWaiverState,
  type CreditCardSource,
  type CreditCardTransaction
} from "@/lib/calc/credit-card";

const source: CreditCardSource = {
  id: "card-1",
  creditLimit: 1000,
  initialOutstandingDebt: 0,
  initialCardCredit: 0,
  annualFeeWaiverSpendTarget: 1000,
  waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z"),
  waiverPeriodEndDate: new Date("2026-12-31T23:59:59.999Z")
};

function card(overrides: Partial<CreditCardSource>): CreditCardSource {
  return {
    ...source,
    ...overrides
  };
}

function tx(
  transaction: Partial<CreditCardTransaction>
): CreditCardTransaction {
  return {
    id: "tx-1",
    amount: 100,
    transactionDate: new Date("2026-02-01T00:00:00.000Z"),
    type: TransactionType.EXPENSE,
    fromMoneySourceId: source.id,
    ...transaction
  };
}

describe("calculateCreditCardState", () => {
  it("basic expense increases debt when there is no card credit", () => {
    expect(
      calculateCreditCardState(source, [
        tx({ amount: 250, type: TransactionType.EXPENSE })
      ]).outstandingDebt
    ).toBe(250);
  });

  it("expense fully covered by card credit leaves debt unchanged and reduces credit", () => {
    expect(
      calculateCreditCardState(card({ initialCardCredit: 300 }), [
        tx({ amount: 100, type: TransactionType.EXPENSE })
      ])
    ).toEqual({
      outstandingDebt: 0,
      availableCredit: 1000,
      cardCredit: 200
    });
  });

  it("expense partially covered by card credit clears credit and adds the remainder to debt", () => {
    expect(
      calculateCreditCardState(card({ initialCardCredit: 75 }), [
        tx({ amount: 200, type: TransactionType.EXPENSE })
      ])
    ).toMatchObject({
      outstandingDebt: 125,
      cardCredit: 0
    });
  });

  it("expense when card credit is zero adds the full expense to debt", () => {
    expect(
      calculateCreditCardState(card({ initialOutstandingDebt: 150 }), [
        tx({ amount: 50, type: TransactionType.EXPENSE })
      ]).outstandingDebt
    ).toBe(200);
  });

  it("payment reduces debt", () => {
    expect(
      calculateCreditCardState(card({ initialOutstandingDebt: 300 }), [
        tx({
          amount: 100,
          type: TransactionType.TRANSFER,
          fromMoneySourceId: "bank-1",
          toMoneySourceId: source.id
        })
      ]).outstandingDebt
    ).toBe(200);
  });

  it("payment exactly equal to debt clears debt and leaves credit unchanged", () => {
    expect(
      calculateCreditCardState(card({ initialOutstandingDebt: 300 }), [
        tx({
          amount: 300,
          type: TransactionType.TRANSFER,
          fromMoneySourceId: "bank-1",
          toMoneySourceId: source.id
        })
      ])
    ).toMatchObject({
      outstandingDebt: 0,
      cardCredit: 0
    });
  });

  it("payment exceeding debt clears debt and stores overflow as card credit", () => {
    expect(
      calculateCreditCardState(card({ initialOutstandingDebt: 125 }), [
        tx({
          amount: 200,
          type: TransactionType.TRANSFER,
          fromMoneySourceId: "bank-1",
          toMoneySourceId: source.id
        })
      ])
    ).toMatchObject({
      outstandingDebt: 0,
      cardCredit: 75
    });
  });

  it("refund reduces debt when debt exists and refund is less than debt", () => {
    expect(
      calculateCreditCardState(card({ initialOutstandingDebt: 300 }), [
        tx({
          amount: 100,
          type: TransactionType.REFUND,
          fromMoneySourceId: null,
          toMoneySourceId: source.id
        })
      ]).outstandingDebt
    ).toBe(200);
  });

  it("refund exceeding debt clears debt and stores overflow as card credit", () => {
    expect(
      calculateCreditCardState(card({ initialOutstandingDebt: 125 }), [
        tx({
          amount: 200,
          type: TransactionType.REFUND,
          fromMoneySourceId: null,
          toMoneySourceId: source.id
        })
      ])
    ).toMatchObject({
      outstandingDebt: 0,
      cardCredit: 75
    });
  });

  it("refund when debt is zero stores the full refund as card credit", () => {
    expect(
      calculateCreditCardState(source, [
        tx({
          amount: 120,
          type: TransactionType.REFUND,
          fromMoneySourceId: null,
          toMoneySourceId: source.id
        })
      ])
    ).toMatchObject({
      outstandingDebt: 0,
      cardCredit: 120
    });
  });

  it("available credit equals credit limit minus debt and floors at zero", () => {
    expect(
      calculateCreditCardState(card({ creditLimit: 500, initialOutstandingDebt: 700 }), [])
        .availableCredit
    ).toBe(0);
  });

  it("card credit does not increase credit limit display", () => {
    expect(
      calculateCreditCardState(card({ creditLimit: 1000, initialCardCredit: 300 }), [])
        .availableCredit
    ).toBe(1000);
  });

});

describe("calculateFeeWaiverState", () => {
  it("calculates eligible spending correctly", () => {
    expect(
      calculateFeeWaiverState(source, [
        tx({ id: "expense-1", amount: 300, countTowardFeeWaiver: true }),
        tx({
          id: "expense-2",
          amount: 200,
          transactionDate: new Date("2026-03-01T00:00:00.000Z"),
          countTowardFeeWaiver: true
        })
      ])
    ).toEqual({
      eligibleSpending: 500,
      progress: 50,
      remaining: 500
    });
  });

  it("deducts linked refunds from eligible spending", () => {
    expect(
      calculateFeeWaiverState(source, [
        tx({ id: "expense-1", amount: 300, countTowardFeeWaiver: true }),
        tx({
          id: "refund-1",
          amount: 80,
          type: TransactionType.REFUND,
          fromMoneySourceId: null,
          toMoneySourceId: source.id,
          relatedTransactionId: "expense-1"
        })
      ]).eligibleSpending
    ).toBe(220);
  });

  it("excludes non-eligible transactions", () => {
    expect(
      calculateFeeWaiverState(source, [
        tx({ id: "expense-1", amount: 300, countTowardFeeWaiver: false }),
        tx({
          id: "expense-2",
          amount: 200,
          fromMoneySourceId: "different-card",
          countTowardFeeWaiver: true
        }),
        tx({
          id: "expense-3",
          amount: 100,
          transactionDate: new Date("2027-01-01T00:00:00.000Z"),
          countTowardFeeWaiver: true
        })
      ]).eligibleSpending
    ).toBe(0);
  });

  it("floors remaining at zero when eligible spending exceeds target", () => {
    expect(
      calculateFeeWaiverState(card({ annualFeeWaiverSpendTarget: 100 }), [
        tx({ id: "expense-1", amount: 150, countTowardFeeWaiver: true })
      ])
    ).toMatchObject({
      eligibleSpending: 150,
      progress: 150,
      remaining: 0
    });
  });

  it("target zero returns zero progress and avoids divide by zero", () => {
    expect(
      calculateFeeWaiverState(card({ annualFeeWaiverSpendTarget: 0 }), [
        tx({ id: "expense-1", amount: 150, countTowardFeeWaiver: true })
      ])
    ).toEqual({
      eligibleSpending: 0,
      progress: 0,
      remaining: 0
    });
  });
});
