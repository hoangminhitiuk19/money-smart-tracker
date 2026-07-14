import { MoneySourceType, QualityRating, TransactionType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTransaction, updateTransaction } from "@/lib/actions/transactions";
import { prisma } from "@/lib/prisma";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

type FakeMoneySource = { id: string; userId: string; type: MoneySourceType };
type FakeRecurringPayment = { id: string; userId: string };
type FakeTransaction = Record<string, unknown> & { id: string; userId: string };

let moneySources: FakeMoneySource[];
let recurringPayments: FakeRecurringPayment[];
let transactions: FakeTransaction[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findFirst: vi.fn(async () => null) },
    financialProject: { findFirst: vi.fn(async () => null) },
    transaction: {
      findFirst: vi.fn(async ({ where }: any) =>
        transactions.find((t) => t.id === where.id && t.userId === where.userId) ?? null
      ),
      create: vi.fn(async ({ data }: any) => {
        const record = { id: "new-transaction", userId: mockUser.id, ...data };
        transactions.push(record);
        return { id: record.id, title: record.title, type: record.type, amount: record.amount };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const target = transactions.find(
          (t) => t.id === where.id && t.userId === where.userId
        );

        if (target) {
          Object.assign(target, data);
        }

        return { count: target ? 1 : 0 };
      })
    },
    moneySource: {
      findMany: vi.fn(async ({ where }: any) =>
        moneySources.filter(
          (source) => where.id.in.includes(source.id) && source.userId === where.userId
        )
      )
    },
    recurringPayment: {
      findFirst: vi.fn(async ({ where }: any) =>
        recurringPayments.find(
          (payment) => payment.id === where.id && payment.userId === where.userId
        ) ?? null
      )
    },
    activityLog: {
      create: vi.fn(async () => ({}))
    }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  moneySources = [
    { id: "ms-a", userId: "user-1", type: MoneySourceType.BANK_ACCOUNT },
    { id: "ms-b", userId: "user-1", type: MoneySourceType.BANK_ACCOUNT },
    { id: "ms-debit", userId: "user-1", type: MoneySourceType.BANK_ACCOUNT },
    { id: "ms-credit", userId: "user-1", type: MoneySourceType.CREDIT_CARD }
  ];
  recurringPayments = [{ id: "rp-own", userId: "user-1" }];
  transactions = [];
});

describe("createTransaction quality rating validation", () => {
  it("rejects a TRANSFER with a qualityRating set", async () => {
    const result = await createTransaction({
      type: TransactionType.TRANSFER,
      amount: 100,
      title: "Move money",
      transactionDate: new Date("2026-01-01"),
      fromMoneySourceId: "ms-a",
      toMoneySourceId: "ms-b",
      qualityRating: QualityRating.S
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quality rating/i);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("still allows a qualityRating on an EXPENSE", async () => {
    const result = await createTransaction({
      type: TransactionType.EXPENSE,
      amount: 50,
      title: "Coffee",
      transactionDate: new Date("2026-01-01"),
      fromMoneySourceId: "ms-a",
      qualityRating: QualityRating.B
    });

    expect(result.ok).toBe(true);
    expect(prisma.transaction.create).toHaveBeenCalled();
  });
});

describe("createTransaction recurringPaymentId ownership", () => {
  it("rejects a recurringPaymentId that does not belong to the user", async () => {
    await expect(
      createTransaction({
        type: TransactionType.EXPENSE,
        amount: 50,
        title: "Coffee",
        transactionDate: new Date("2026-01-01"),
        fromMoneySourceId: "ms-a",
        recurringPaymentId: "rp-foreign"
      })
    ).rejects.toThrow("Referenced record not found.");

    expect(prisma.recurringPayment.findFirst).toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("accepts a recurringPaymentId that belongs to the user", async () => {
    const result = await createTransaction({
      type: TransactionType.EXPENSE,
      amount: 50,
      title: "Coffee",
      transactionDate: new Date("2026-01-01"),
      fromMoneySourceId: "ms-a",
      recurringPaymentId: "rp-own"
    });

    expect(result.ok).toBe(true);
    expect(prisma.recurringPayment.findFirst).toHaveBeenCalled();
    expect(prisma.transaction.create).toHaveBeenCalled();
  });
});

describe("updateTransaction countTowardFeeWaiver recompute", () => {
  beforeEach(() => {
    transactions = [
      {
        id: "t1",
        userId: "user-1",
        type: TransactionType.EXPENSE,
        amount: 50,
        currency: "VND",
        title: "Coffee",
        description: null,
        transactionDate: new Date("2026-01-01"),
        categoryId: null,
        qualityRating: null,
        fromMoneySourceId: "ms-debit",
        toMoneySourceId: null,
        adjustedMoneySourceId: null,
        adjustmentDirection: null,
        adjustmentTarget: null,
        projectId: null,
        relatedTransactionId: null,
        countTowardFeeWaiver: false,
        recurringPaymentId: null,
        isInstallmentRelated: false
      }
    ];
  });

  it("recomputes the default when fromMoneySourceId moves onto a credit card", async () => {
    const result = await updateTransaction("t1", { fromMoneySourceId: "ms-credit" });

    expect(result.ok).toBe(true);
    expect(transactions[0].countTowardFeeWaiver).toBe(true);
  });

  it("keeps the existing value when an unrelated field changes", async () => {
    const result = await updateTransaction("t1", { title: "Coffee (updated)" });

    expect(result.ok).toBe(true);
    expect(transactions[0].countTowardFeeWaiver).toBe(false);
  });

  it("still respects an explicit countTowardFeeWaiver override", async () => {
    const result = await updateTransaction("t1", { countTowardFeeWaiver: true });

    expect(result.ok).toBe(true);
    expect(transactions[0].countTowardFeeWaiver).toBe(true);
  });
});
