import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTransaction,
  searchTransactions,
  updateTransaction
} from "@/lib/actions/transactions";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

type FakeMoneySource = { id: string; userId: string; type: MoneySourceType };
type FakeCategory = {
  id: string;
  userId: string;
  defaultCountTowardFeeWaiver: boolean;
};
type FakeProject = { id: string; userId: string };
type FakeRecurringPayment = { id: string; userId: string };
type FakeTransaction = Record<string, unknown> & { id: string; userId: string };

let categories: FakeCategory[];
let projects: FakeProject[];
let moneySources: FakeMoneySource[];
let recurringPayments: FakeRecurringPayment[];
let transactions: FakeTransaction[];

function matchesTransactionWhere(transaction: FakeTransaction, where: any) {
  if (transaction.userId !== where.userId) {
    return false;
  }

  if (where.OR) {
    return where.OR.some((sourceFilter: Record<string, string>) =>
      Object.entries(sourceFilter).every(
        ([field, value]) => transaction[field] === value
      )
    );
  }

  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findFirst: vi.fn(async ({ where }: any) =>
        categories.find(
          (category) =>
            category.id === where.id && category.userId === where.userId
        ) ?? null
      )
    },
    financialProject: {
      findFirst: vi.fn(async ({ where }: any) =>
        projects.find(
          (project) => project.id === where.id && project.userId === where.userId
        ) ?? null
      )
    },
    transaction: {
      findFirst: vi.fn(async ({ where }: any) =>
        transactions.find(
          (transaction) =>
            transaction.id === where.id &&
            transaction.userId === where.userId &&
            (where.type === undefined || transaction.type === where.type)
        ) ?? null
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
      }),
      findMany: vi.fn(async ({ where }: any) =>
        transactions.filter((transaction) => matchesTransactionWhere(transaction, where))
      ),
      count: vi.fn(async ({ where }: any) =>
        transactions.filter((transaction) => matchesTransactionWhere(transaction, where)).length
      )
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
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
  moneySources = [
    { id: "ms-a", userId: "user-1", type: MoneySourceType.BANK_ACCOUNT },
    { id: "ms-b", userId: "user-1", type: MoneySourceType.BANK_ACCOUNT },
    { id: "ms-debit", userId: "user-1", type: MoneySourceType.BANK_ACCOUNT },
    { id: "ms-credit", userId: "user-1", type: MoneySourceType.CREDIT_CARD }
  ];
  categories = [
    {
      id: "category-eligible",
      userId: "user-1",
      defaultCountTowardFeeWaiver: true
    },
    {
      id: "category-excluded",
      userId: "user-1",
      defaultCountTowardFeeWaiver: false
    }
  ];
  projects = [{ id: "project-own", userId: "user-1" }];
  recurringPayments = [{ id: "rp-own", userId: "user-1" }];
  transactions = [];
});

describe("transaction mutation rate limiting", () => {
  it("denies a rate-limited create before checking referenced records or writing", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await createTransaction({
      type: TransactionType.EXPENSE,
      amount: 50,
      title: "Coffee",
      transactionDate: new Date("2026-01-01"),
      fromMoneySourceId: "ms-a",
      recurringPaymentId: "rp-own"
    });

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.recurringPayment.findFirst).not.toHaveBeenCalled();
    expect(prisma.moneySource.findMany).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });
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

describe("createTransaction exact decimal validation", () => {
  it("passes exact Decimal text to Prisma without Number coercion", async () => {
    const result = await createTransaction({
      type: TransactionType.EXPENSE,
      amount: "90071992547409.99",
      title: "Exact purchase",
      transactionDate: new Date("2026-01-01"),
      fromMoneySourceId: "ms-a"
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: "90071992547409.99" })
      })
    );
  });

  it.each(["0", "-1", "0.001", "99999999999999999.99"])(
    "rejects amount %s before transaction or activity writes",
    async (amount) => {
      const result = await createTransaction({
        type: TransactionType.EXPENSE,
        amount,
        title: "Invalid purchase",
        transactionDate: new Date("2026-01-01"),
        fromMoneySourceId: "ms-a"
      });

      expect(result).toEqual({
        ok: false,
        error: "Enter a valid transaction."
      });
      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );
});

describe("createTransaction refund relation rules", () => {
  beforeEach(() => {
    transactions = [
      {
        id: "expense-own",
        userId: "user-1",
        type: TransactionType.EXPENSE,
        amount: "25.00"
      },
      {
        id: "income-own",
        userId: "user-1",
        type: TransactionType.INCOME,
        amount: "25.00"
      },
      {
        id: "expense-foreign",
        userId: "user-2",
        type: TransactionType.EXPENSE,
        amount: "25.00"
      }
    ];
  });

  it("accepts a same-user EXPENSE link on a REFUND", async () => {
    const result = await createTransaction({
      type: TransactionType.REFUND,
      amount: "25.00",
      title: "Returned purchase",
      transactionDate: new Date("2026-01-02"),
      toMoneySourceId: "ms-a",
      relatedTransactionId: "expense-own"
    });

    expect(result).toEqual({ ok: true });
  });

  it.each(["income-own", "expense-foreign"])(
    "rejects invalid REFUND relation %s without writes",
    async (relatedTransactionId) => {
      await expect(
        createTransaction({
          type: TransactionType.REFUND,
          amount: "25.00",
          title: "Invalid refund",
          transactionDate: new Date("2026-01-02"),
          toMoneySourceId: "ms-a",
          relatedTransactionId
        })
      ).rejects.toThrow();

      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );

  it("rejects a relation on a non-REFUND without writes", async () => {
    const result = await createTransaction({
      type: TransactionType.EXPENSE,
      amount: "25.00",
      title: "Invalid relation",
      transactionDate: new Date("2026-01-02"),
      fromMoneySourceId: "ms-a",
      relatedTransactionId: "expense-own"
    });

    expect(result.ok).toBe(false);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });
});

describe("createTransaction adjustment target rules", () => {
  it("defaults a credit-card adjustment target to CREDIT_CARD_DEBT", async () => {
    const result = await createTransaction({
      type: TransactionType.ADJUSTMENT,
      amount: "10.00",
      title: "Correct card debt",
      transactionDate: new Date("2026-01-03"),
      adjustedMoneySourceId: "ms-credit",
      adjustmentDirection: AdjustmentDirection.INCREASE
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT
        })
      })
    );
  });

  it("persists CARD_CREDIT when explicitly selected", async () => {
    const result = await createTransaction({
      type: TransactionType.ADJUSTMENT,
      amount: "10.00",
      title: "Correct card credit",
      transactionDate: new Date("2026-01-03"),
      adjustedMoneySourceId: "ms-credit",
      adjustmentDirection: AdjustmentDirection.DECREASE,
      adjustmentTarget: AdjustmentTarget.CARD_CREDIT
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adjustmentTarget: AdjustmentTarget.CARD_CREDIT
        })
      })
    );
  });

  it("rejects a target for a non-card adjustment without writes", async () => {
    const result = await createTransaction({
      type: TransactionType.ADJUSTMENT,
      amount: "10.00",
      title: "Invalid bank target",
      transactionDate: new Date("2026-01-03"),
      adjustedMoneySourceId: "ms-a",
      adjustmentDirection: AdjustmentDirection.INCREASE,
      adjustmentTarget: AdjustmentTarget.CARD_CREDIT
    });

    expect(result.ok).toBe(false);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });
});

describe("createTransaction owned references and waiver defaults", () => {
  it("uses the selected category's waiver exclusion for a card expense", async () => {
    const result = await createTransaction({
      type: TransactionType.EXPENSE,
      amount: "50.00",
      title: "Annual fee",
      transactionDate: new Date("2026-01-01"),
      fromMoneySourceId: "ms-credit",
      categoryId: "category-excluded"
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ countTowardFeeWaiver: false })
      })
    );
  });

  it("preserves an explicit waiver override over the category default", async () => {
    const result = await createTransaction({
      type: TransactionType.EXPENSE,
      amount: "50.00",
      title: "Manually eligible fee",
      transactionDate: new Date("2026-01-01"),
      fromMoneySourceId: "ms-credit",
      categoryId: "category-excluded",
      countTowardFeeWaiver: true
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ countTowardFeeWaiver: true })
      })
    );
  });

  it.each([
    ["categoryId", "category-foreign"],
    ["projectId", "project-foreign"],
    ["fromMoneySourceId", "source-foreign"],
    ["recurringPaymentId", "renewal-foreign"]
  ] as const)(
    "rejects an unowned %s without transaction or activity writes",
    async (field, value) => {
      const resultPromise = createTransaction({
        type: TransactionType.EXPENSE,
        amount: "50.00",
        title: "Foreign reference",
        transactionDate: new Date("2026-01-01"),
        fromMoneySourceId: field === "fromMoneySourceId" ? value : "ms-a",
        [field]: value
      });

      await expect(resultPromise).rejects.toThrow();
      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );
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

describe("searchTransactions money source filtering", () => {
  it("returns an adjustment whose adjusted source matches the filter", async () => {
    transactions = [
      {
        id: "adjustment-1",
        userId: "user-1",
        type: TransactionType.ADJUSTMENT,
        adjustedMoneySourceId: "ms-a"
      }
    ];

    const result = await searchTransactions({ moneySourceId: "ms-a" });

    expect(result.transactions.map((transaction) => transaction.id)).toEqual([
      "adjustment-1"
    ]);
  });
});

describe("searchTransactions date filtering", () => {
  it.each(["", "2026-02-30", "not-a-date"])(
    "rejects an invalid date boundary before querying: %s",
    async (startDate) => {
      await expect(searchTransactions({ startDate })).rejects.toThrow(
        "Date filters must use valid YYYY-MM-DD calendar dates."
      );

      expect(prisma.transaction.findMany).not.toHaveBeenCalled();
      expect(prisma.transaction.count).not.toHaveBeenCalled();
    }
  );
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

describe("updateTransaction nullable fields and type transitions", () => {
  beforeEach(() => {
    transactions = [
      {
        id: "expense-own",
        userId: "user-1",
        type: TransactionType.EXPENSE,
        amount: "50.00",
        currency: "VND",
        title: "Coffee",
        description: "Morning coffee",
        transactionDate: new Date("2026-01-01"),
        categoryId: "category-eligible",
        qualityRating: QualityRating.B,
        fromMoneySourceId: "ms-debit",
        toMoneySourceId: null,
        adjustedMoneySourceId: null,
        adjustmentDirection: null,
        adjustmentTarget: null,
        projectId: "project-own",
        relatedTransactionId: null,
        countTowardFeeWaiver: false,
        recurringPaymentId: "rp-own",
        isInstallmentRelated: false
      },
      {
        id: "refund-own",
        userId: "user-1",
        type: TransactionType.REFUND,
        amount: "10.00",
        currency: "VND",
        title: "Coffee refund",
        description: null,
        transactionDate: new Date("2026-01-02"),
        categoryId: null,
        qualityRating: null,
        fromMoneySourceId: null,
        toMoneySourceId: "ms-a",
        adjustedMoneySourceId: null,
        adjustmentDirection: null,
        adjustmentTarget: null,
        projectId: null,
        relatedTransactionId: "expense-own",
        countTowardFeeWaiver: false,
        recurringPaymentId: null,
        isInstallmentRelated: false
      }
    ];
  });

  it("clears stale expense-only and from-source state on EXPENSE to INCOME", async () => {
    const result = await updateTransaction("expense-own", {
      type: TransactionType.INCOME,
      toMoneySourceId: "ms-a"
    });

    expect(result).toEqual({ ok: true });
    expect(transactions[0]).toMatchObject({
      type: TransactionType.INCOME,
      fromMoneySourceId: null,
      toMoneySourceId: "ms-a",
      qualityRating: null,
      adjustedMoneySourceId: null,
      adjustmentDirection: null,
      adjustmentTarget: null,
      relatedTransactionId: null,
      countTowardFeeWaiver: false
    });
  });

  it("uses null to clear nullable fields", async () => {
    const result = await updateTransaction("expense-own", {
      categoryId: null,
      description: null,
      projectId: null,
      recurringPaymentId: null
    });

    expect(result).toEqual({ ok: true });
    expect(transactions[0]).toMatchObject({
      categoryId: null,
      description: null,
      projectId: null,
      recurringPaymentId: null
    });
  });

  it("uses undefined to retain nullable fields", async () => {
    const result = await updateTransaction("expense-own", {
      title: "Coffee renamed"
    });

    expect(result).toEqual({ ok: true });
    expect(transactions[0]).toMatchObject({
      categoryId: "category-eligible",
      description: "Morning coffee",
      projectId: "project-own",
      recurringPaymentId: "rp-own"
    });
  });

  it("unlinks a refund when relatedTransactionId is null", async () => {
    const result = await updateTransaction("refund-own", {
      relatedTransactionId: null
    });

    expect(result).toEqual({ ok: true });
    expect(transactions[1].relatedTransactionId).toBeNull();
  });

  it("clears stale adjustment state when changing to EXPENSE", async () => {
    transactions[0] = {
      ...transactions[0],
      type: TransactionType.ADJUSTMENT,
      categoryId: null,
      qualityRating: null,
      fromMoneySourceId: null,
      adjustedMoneySourceId: "ms-credit",
      adjustmentDirection: AdjustmentDirection.INCREASE,
      adjustmentTarget: AdjustmentTarget.CARD_CREDIT,
      projectId: null,
      recurringPaymentId: null
    };

    const result = await updateTransaction("expense-own", {
      type: TransactionType.EXPENSE,
      fromMoneySourceId: "ms-a",
      qualityRating: QualityRating.A
    });

    expect(result).toEqual({ ok: true });
    expect(transactions[0]).toMatchObject({
      type: TransactionType.EXPENSE,
      fromMoneySourceId: "ms-a",
      adjustedMoneySourceId: null,
      adjustmentDirection: null,
      adjustmentTarget: null,
      qualityRating: QualityRating.A
    });
  });
});
