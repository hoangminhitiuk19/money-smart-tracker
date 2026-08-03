import { TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/activity", () => ({
  transactionCreatedMetadata: vi.fn()
}));

import {
  parseTransactionCreateInput,
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
});
