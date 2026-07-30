import { MoneySourceType, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildAccountDetailTransactionScope } from "@/lib/account-transaction-scope";
import { calculateAccountProjection } from "@/lib/calc/dashboard";

describe("buildAccountDetailTransactionScope", () => {
  it("keeps non-card recent transactions limited to direct source references", () => {
    expect(
      buildAccountDetailTransactionScope({
        userId: "user-1",
        sourceId: "bank-1",
        sourceType: MoneySourceType.BANK_ACCOUNT
      })
    ).toEqual({
      userId: "user-1",
      OR: [
        { fromMoneySourceId: "bank-1" },
        { toMoneySourceId: "bank-1" },
        { adjustedMoneySourceId: "bank-1" }
      ]
    });

    const projection = calculateAccountProjection(
      {
        id: "bank-1",
        type: MoneySourceType.BANK_ACCOUNT,
        openingBalance: "100.00"
      },
      [
        {
          id: "income-1",
          createdAt: new Date("2026-07-10T09:00:01.000Z"),
          type: TransactionType.INCOME,
          amount: "25.00",
          transactionDate: new Date("2026-07-10T09:00:00.000Z"),
          toMoneySourceId: "bank-1"
        },
        {
          id: "refund-1",
          createdAt: new Date("2026-07-11T09:00:01.000Z"),
          type: TransactionType.REFUND,
          amount: "90.00",
          transactionDate: new Date("2026-07-11T09:00:00.000Z"),
          toMoneySourceId: "different-bank",
          relatedTransactionId: "expense-from-bank-1"
        }
      ]
    );

    expect(projection.trackedAmount.toFixed(2)).toBe("125.00");
    expect(projection.creditCardState).toBeNull();
  });

  it("adds cross-destination linked refunds only for credit cards", () => {
    expect(
      buildAccountDetailTransactionScope({
        userId: "user-1",
        sourceId: "card-1",
        sourceType: MoneySourceType.CREDIT_CARD
      })
    ).toEqual({
      userId: "user-1",
      OR: [
        { fromMoneySourceId: "card-1" },
        { toMoneySourceId: "card-1" },
        { adjustedMoneySourceId: "card-1" },
        {
          relatedTransaction: {
            is: {
              type: TransactionType.EXPENSE,
              fromMoneySourceId: "card-1"
            }
          }
        }
      ]
    });
  });
});
