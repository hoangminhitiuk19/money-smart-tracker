import { randomUUID } from "node:crypto";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  calculateCreditCardState,
  calculateFeeWaiverState
} from "@/lib/calc/credit-card";
import { buildAccountDetailTransactionScope } from "@/lib/account-transaction-scope";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext
} from "@/tests/integration/helpers/audit-context";
import {
  REFERENCE_AMOUNTS,
  REFERENCE_DATES,
  REFERENCE_EXPECTED_LEDGER
} from "@/tests/integration/helpers/reference-ledger";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("credit-card reference ledger", () => {
  it("reconciles deterministic debt, credit, available credit, and waiver spending from PostgreSQL", async () => {
    const context = await createAuditContext(
      `credit-card-ledger-${randomUUID()}`
    );
    const fixturePrefix = `credit-card-ledger-${randomUUID()}`;
    const bankId = `${fixturePrefix}-bank`;
    const cardId = `${fixturePrefix}-card`;
    const userBCardId = `${fixturePrefix}-user-b-card`;
    const eligibleExpenseId = `${fixturePrefix}-eligible-expense`;
    const excludedExpenseId = `${fixturePrefix}-excluded-expense`;
    const refundId = `${fixturePrefix}-bank-refund`;
    const debtAdjustmentId = `${fixturePrefix}-a-debt-adjustment`;
    const paymentId = `${fixturePrefix}-b-payment`;
    const creditAdjustmentId = `${fixturePrefix}-credit-adjustment`;
    const userBExpenseId = `${fixturePrefix}-user-b-expense`;
    const userBRefundId = `${fixturePrefix}-user-b-refund`;
    const transactionIds = [
      eligibleExpenseId,
      excludedExpenseId,
      refundId,
      debtAdjustmentId,
      paymentId,
      creditAdjustmentId
    ];

    try {
      const [, card] = await prisma.$transaction([
        prisma.moneySource.create({
          data: {
            id: bankId,
            userId: context.userA.id,
            name: "Reference ledger bank",
            type: MoneySourceType.BANK_ACCOUNT
          }
        }),
        prisma.moneySource.create({
          data: {
            id: cardId,
            userId: context.userA.id,
            name: "Reference ledger card",
            type: MoneySourceType.CREDIT_CARD,
            creditLimit: "2000.00",
            initialOutstandingDebt: "300.00",
            initialCardCredit: "500.00",
            annualFeeWaiverEnabled: true,
            annualFeeWaiverSpendTarget: REFERENCE_AMOUNTS.feeWaiverTarget,
            waiverPeriodStartDate: REFERENCE_DATES.ledgerStart,
            waiverPeriodEndDate: REFERENCE_DATES.periodEndInclusive
          }
        }),
        prisma.moneySource.create({
          data: {
            id: userBCardId,
            userId: context.userB.id,
            name: "Adversarial user B card",
            type: MoneySourceType.CREDIT_CARD,
            creditLimit: "9999.00",
            initialOutstandingDebt: "999.00",
            initialCardCredit: "999.00",
            annualFeeWaiverEnabled: true,
            annualFeeWaiverSpendTarget: "9999.00",
            waiverPeriodStartDate: REFERENCE_DATES.ledgerStart,
            waiverPeriodEndDate: REFERENCE_DATES.periodEndInclusive
          }
        })
      ]);
      await prisma.transaction.create({
        data: {
          id: eligibleExpenseId,
          userId: context.userA.id,
          type: TransactionType.EXPENSE,
          amount: "300.00",
          title: "Reference eligible card expense",
          transactionDate: REFERENCE_DATES.cardExpense,
          createdAt: new Date("2026-07-10T08:59:59.000Z"),
          fromMoneySourceId: cardId,
          countTowardFeeWaiver: true
        }
      });
      await prisma.$transaction([
        prisma.transaction.create({
          data: {
            id: debtAdjustmentId,
            userId: context.userA.id,
            type: TransactionType.ADJUSTMENT,
            amount: "100.00",
            title: "Reference debt adjustment",
            transactionDate: REFERENCE_DATES.cardExpense,
            createdAt: REFERENCE_DATES.sameDayFirstCreatedAt,
            adjustedMoneySourceId: cardId,
            adjustmentDirection: AdjustmentDirection.INCREASE,
            adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT
          }
        }),
        prisma.transaction.create({
          data: {
            id: paymentId,
            userId: context.userA.id,
            type: TransactionType.TRANSFER,
            amount: "315.00",
            title: "Reference card payment",
            transactionDate: REFERENCE_DATES.cardExpense,
            createdAt: REFERENCE_DATES.sameDaySecondCreatedAt,
            fromMoneySourceId: bankId,
            toMoneySourceId: cardId
          }
        }),
        prisma.transaction.create({
          data: {
            id: excludedExpenseId,
            userId: context.userA.id,
            type: TransactionType.EXPENSE,
            amount: "140.00",
            title: "Reference excluded card expense",
            transactionDate: new Date("2026-07-11T09:00:00.000Z"),
            createdAt: new Date("2026-07-11T09:00:01.000Z"),
            fromMoneySourceId: cardId,
            countTowardFeeWaiver: false
          }
        }),
        prisma.transaction.create({
          data: {
            id: refundId,
            userId: context.userA.id,
            type: TransactionType.REFUND,
            amount: REFERENCE_AMOUNTS.linkedRefund,
            title: "Reference refund to bank",
            transactionDate: new Date("2026-07-12T09:00:00.000Z"),
            createdAt: new Date("2026-07-12T09:00:01.000Z"),
            toMoneySourceId: bankId,
            relatedTransactionId: eligibleExpenseId
          }
        }),
        prisma.transaction.create({
          data: {
            id: creditAdjustmentId,
            userId: context.userA.id,
            type: TransactionType.ADJUSTMENT,
            amount: "45.00",
            title: "Reference card credit adjustment",
            transactionDate: new Date("2026-07-13T09:00:00.000Z"),
            createdAt: new Date("2026-07-13T09:00:01.000Z"),
            adjustedMoneySourceId: cardId,
            adjustmentDirection: AdjustmentDirection.DECREASE,
            adjustmentTarget: AdjustmentTarget.CARD_CREDIT
          }
        }),
        prisma.transaction.create({
          data: {
            id: userBExpenseId,
            userId: context.userB.id,
            type: TransactionType.EXPENSE,
            amount: "999.00",
            title: "Adversarial user B card expense",
            transactionDate: REFERENCE_DATES.cardExpense,
            createdAt: new Date("2026-07-10T09:00:00.500Z"),
            fromMoneySourceId: userBCardId,
            countTowardFeeWaiver: true
          }
        }),
        prisma.transaction.create({
          data: {
            id: userBRefundId,
            userId: context.userB.id,
            type: TransactionType.REFUND,
            amount: "999.00",
            title: "Adversarial cross-user refund",
            transactionDate: new Date("2026-07-12T09:00:00.000Z"),
            createdAt: new Date("2026-07-12T09:00:00.500Z"),
            toMoneySourceId: cardId,
            relatedTransactionId: eligibleExpenseId
          }
        })
      ]);

      const transactions = await prisma.transaction.findMany({
        where: buildAccountDetailTransactionScope({
          userId: context.userA.id,
          sourceId: cardId,
          sourceType: MoneySourceType.CREDIT_CARD
        }),
        orderBy: [
          { transactionDate: "desc" },
          { createdAt: "desc" },
          { id: "desc" }
        ]
      });
      const originalOrder = transactions.map((transaction) => transaction.id);
      const userBTransactions = await prisma.transaction.findMany({
        where: {
          userId: context.userB.id,
          id: { in: [userBExpenseId, userBRefundId] }
        },
        orderBy: { id: "asc" }
      });

      const state = calculateCreditCardState(card, transactions);
      const waiver = calculateFeeWaiverState(card, transactions);
      const leakedState = calculateCreditCardState(card, [
        ...transactions,
        ...userBTransactions
      ]);
      const leakedWaiver = calculateFeeWaiverState(card, [
        ...transactions,
        ...userBTransactions
      ]);

      expect(transactions).toHaveLength(transactionIds.length);
      expect(
        transactions.every(
          (transaction) => transaction.userId === context.userA.id
        )
      ).toBe(true);
      expect(transactions.map((transaction) => transaction.id)).not.toContain(
        userBRefundId
      );
      expect(userBTransactions).toHaveLength(2);
      expect(
        userBTransactions.every(
          (transaction) => transaction.userId === context.userB.id
        )
      ).toBe(true);
      expect(leakedState.outstandingDebt.toFixed(2)).toBe("0.00");
      expect(leakedState.cardCredit.toFixed(2)).toBe("929.00");
      expect(leakedWaiver.eligibleSpending.toFixed(2)).toBe("-789.00");
      expect(state.outstandingDebt.toFixed(2)).toBe(
        REFERENCE_EXPECTED_LEDGER.outstandingDebt
      );
      expect(state.cardCredit.toFixed(2)).toBe(
        REFERENCE_EXPECTED_LEDGER.cardCredit
      );
      expect(state.availableCredit.toFixed(2)).toBe(
        REFERENCE_EXPECTED_LEDGER.availableCredit
      );
      expect(waiver.eligibleSpending.toFixed(2)).toBe(
        REFERENCE_EXPECTED_LEDGER.eligibleSpending
      );
      expect(waiver.remaining.toFixed(2)).toBe(
        REFERENCE_EXPECTED_LEDGER.feeWaiverRemaining
      );
      expect(transactions.map((transaction) => transaction.id)).toEqual(
        originalOrder
      );
    } finally {
      await cleanupAuditContext(context);
    }
  }, 20_000);
});
