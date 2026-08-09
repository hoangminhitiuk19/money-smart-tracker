import { MoneySourceType, Prisma, TransactionType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  parseTransactionCreateInput,
  persistPreparedTransactions,
  prepareTransactionCreate
} from "@/lib/transactions/create";

describe("canonical transaction creation", () => {
  it("preserves Decimal(18,2) input as exact text", () => {
    const parsed = parseTransactionCreateInput({
      type: TransactionType.INCOME,
      amount: "90071992547409.99",
      title: "Salary",
      transactionDate: "2026-08-03",
      toMoneySourceId: "bank-a"
    });

    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      expect(parsed.data.amount).toBe("90071992547409.99");
    }
  });

  it("rejects a foreign reference set before persistence", () => {
    const parsed = parseTransactionCreateInput({
      type: TransactionType.EXPENSE,
      amount: "45.00",
      title: "Coffee",
      transactionDate: "2026-08-03",
      fromMoneySourceId: "foreign-source"
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(
      prepareTransactionCreate(parsed.data, {
        categories: new Map(),
        expenses: new Set(),
        moneySources: new Map(),
        projects: new Set(),
        recurringPayments: new Set()
      })
    ).toEqual({
      ok: false,
      issues: [
        {
          field: "fromMoneySourceId",
          message: "Referenced money source not found."
        }
      ]
    });
  });

  it("bulk persists in prepared order and writes exact activity metadata", async () => {
    const references = {
      categories: new Map(),
      expenses: new Set<string>(),
      moneySources: new Map([
        ["bank-a", { type: MoneySourceType.BANK_ACCOUNT }]
      ]),
      projects: new Set<string>(),
      recurringPayments: new Set<string>()
    };
    const prepared = [
      {
        type: TransactionType.INCOME,
        amount: "90071992547409.99",
        title: "Exact salary",
        transactionDate: "2026-08-03",
        toMoneySourceId: "bank-a"
      },
      {
        type: TransactionType.EXPENSE,
        amount: "45.25",
        title: "Lunch",
        transactionDate: "2026-08-04",
        fromMoneySourceId: "bank-a"
      }
    ].map((input) => {
      const parsed = parseTransactionCreateInput(input);
      if (!parsed.ok) throw new Error(parsed.issues[0].message);
      const result = prepareTransactionCreate(parsed.data, references);
      if (!result.ok) throw new Error(result.issues[0].message);
      return result.data;
    });
    const createdAt = new Date("2026-08-04T00:00:00.000Z");
    const createManyAndReturn = vi.fn(async ({ data }: any) =>
      [...data].reverse().map((row) => ({
        ...row,
        amount: new Prisma.Decimal(row.amount),
        createdAt,
        updatedAt: createdAt
      }))
    );
    const createActivities = vi.fn(async ({ data }: any) => ({
      count: data.length
    }));
    const db = {
      transaction: { createManyAndReturn },
      activityLog: { createMany: createActivities }
    } as unknown as Prisma.TransactionClient;

    const transactions = await persistPreparedTransactions(
      db,
      "user-1",
      prepared
    );

    expect(transactions.map(({ title }) => title)).toEqual([
      "Exact salary",
      "Lunch"
    ]);
    transactions.forEach(({ id }) =>
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
    );
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
    const persistedRows = createManyAndReturn.mock.calls[0]?.[0].data as Array<{
      createdAt?: Date;
    }>;
    expect(
      persistedRows[1].createdAt!.getTime() -
        persistedRows[0].createdAt!.getTime()
    ).toBe(1);
    expect(createActivities).toHaveBeenCalledWith({
      data: [
        {
          userId: "user-1",
          action: "TRANSACTION_CREATED",
          entityType: "Transaction",
          entityId: transactions[0].id,
          metadata: {
            amount: "90071992547409.99",
            type: TransactionType.INCOME,
            title: "Exact salary",
            fromSourceId: null,
            toSourceId: "bank-a"
          }
        },
        {
          userId: "user-1",
          action: "TRANSACTION_CREATED",
          entityType: "Transaction",
          entityId: transactions[1].id,
          metadata: {
            amount: "45.25",
            type: TransactionType.EXPENSE,
            title: "Lunch",
            fromSourceId: "bank-a",
            toSourceId: null
          }
        }
      ]
    });
  });
});
