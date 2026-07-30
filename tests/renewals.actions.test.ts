import {
  MoneySourceType,
  QualityRating,
  RenewalFrequency,
  RenewalStatus,
  TransactionType
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRenewal,
  markRenewalAsPaid,
  pauseRenewal,
  pauseRenewalFormAction,
  skipRenewalCycle,
  updateRenewal
} from "@/lib/actions/renewals";
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

vi.mock("@/lib/prisma", () => {
  const recurringPayment = {
    create: vi.fn(async ({ data }: any) => ({
      id: "new-renewal",
      title: data.title,
      amount: data.amount,
      status: data.status
    })),
    findFirst: vi.fn(async () => ({
      id: "renewal-1",
      userId: mockUser.id,
      title: "Gym membership",
      description: null,
      amount: 30,
      currency: "VND",
      transactionType: TransactionType.EXPENSE,
      qualityRating: null,
      fromMoneySourceId: "ms-a",
      toMoneySourceId: null,
      categoryId: null,
      projectId: null,
      countTowardFeeWaiver: false,
      frequency: RenewalFrequency.MONTHLY,
      intervalCount: 1,
      nextDueDate: new Date("2026-02-01"),
      reminderDaysBefore: 3,
      autoCreateTransaction: false,
      status: RenewalStatus.ACTIVE,
      lastGeneratedDate: null
    })),
    updateMany: vi.fn(async () => ({ count: 1 }))
  };
  const transaction = { create: vi.fn(async () => ({ id: "transaction-1" })) };
  const activityLog = { create: vi.fn(async () => ({})) };

  return {
    prisma: {
    category: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id
          ? {
              id: where.id,
              defaultCountTowardFeeWaiver: where.id !== "category-excluded"
            }
          : null
      )
    },
    financialProject: { findFirst: vi.fn(async () => null) },
    moneySource: {
      findMany: vi.fn(async ({ where }: any) =>
        where.id.in.map((id: string) => ({
          id,
          type:
            id === "ms-credit"
              ? MoneySourceType.CREDIT_CARD
              : MoneySourceType.BANK_ACCOUNT
        }))
      )
    },
      recurringPayment,
      transaction,
      $transaction: vi.fn(async (callback: any) =>
        callback({ transaction, recurringPayment, activityLog })
      ),
      activityLog
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
});

describe("renewal mutation rate limiting", () => {
  it("denies a rate-limited paid renewal before recurring-payment and transaction writes", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await markRenewalAsPaid("renewal-1");

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.recurringPayment.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.recurringPayment.updateMany).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("consumes one rate-limit token when pausing through the form wrapper", async () => {
    await pauseRenewalFormAction("renewal-1");

    expect(checkAuthenticatedMutation).toHaveBeenCalledTimes(1);
    expect(checkAuthenticatedMutation).toHaveBeenCalledWith("user-1");
  });

  it("consumes one rate-limit token when pausing through the public action", async () => {
    await pauseRenewal("renewal-1");

    expect(checkAuthenticatedMutation).toHaveBeenCalledTimes(1);
    expect(checkAuthenticatedMutation).toHaveBeenCalledWith("user-1");
  });
});

describe("renewal cycle status enforcement", () => {
  it.each([RenewalStatus.PAUSED, RenewalStatus.CANCELLED])(
    "rejects marking a %s renewal paid without writes",
    async (status) => {
      vi.mocked(prisma.recurringPayment.findFirst).mockResolvedValueOnce({
        id: "renewal-1",
        userId: mockUser.id,
        title: "Gym membership",
        description: null,
        amount: 30 as any,
        currency: "VND",
        transactionType: TransactionType.EXPENSE,
        qualityRating: null,
        fromMoneySourceId: "ms-a",
        toMoneySourceId: null,
        categoryId: null,
        projectId: null,
        countTowardFeeWaiver: false,
        frequency: RenewalFrequency.MONTHLY,
        intervalCount: 1,
        nextDueDate: new Date("2026-02-01"),
        reminderDaysBefore: 3,
        autoCreateTransaction: false,
        status,
        lastGeneratedDate: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await expect(markRenewalAsPaid("renewal-1")).rejects.toThrow(
        "Renewal is not active."
      );
      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.recurringPayment.updateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );

  it.each([RenewalStatus.PAUSED, RenewalStatus.CANCELLED])(
    "rejects skipping a %s renewal without writes",
    async (status) => {
      vi.mocked(prisma.recurringPayment.findFirst).mockResolvedValueOnce({
        id: "renewal-1",
        userId: mockUser.id,
        title: "Gym membership",
        description: null,
        amount: 30 as any,
        currency: "VND",
        transactionType: TransactionType.EXPENSE,
        qualityRating: null,
        fromMoneySourceId: "ms-a",
        toMoneySourceId: null,
        categoryId: null,
        projectId: null,
        countTowardFeeWaiver: false,
        frequency: RenewalFrequency.MONTHLY,
        intervalCount: 1,
        nextDueDate: new Date("2026-02-01"),
        reminderDaysBefore: 3,
        autoCreateTransaction: false,
        status,
        lastGeneratedDate: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await expect(skipRenewalCycle("renewal-1")).rejects.toThrow(
        "Renewal is not active."
      );
      expect(prisma.recurringPayment.updateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );
});

describe("createRenewal quality rating validation", () => {
  it("rejects a TRANSFER renewal with a qualityRating set", async () => {
    const result = await createRenewal({
      title: "Move to savings",
      amount: 100,
      transactionType: TransactionType.TRANSFER,
      qualityRating: QualityRating.S,
      frequency: RenewalFrequency.MONTHLY,
      nextDueDate: new Date("2026-02-01"),
      fromMoneySourceId: "ms-a",
      toMoneySourceId: "ms-b"
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quality rating/i);
    expect(prisma.recurringPayment.create).not.toHaveBeenCalled();
  });

  it("still allows a qualityRating on an EXPENSE renewal", async () => {
    const result = await createRenewal({
      title: "Gym membership",
      amount: 30,
      transactionType: TransactionType.EXPENSE,
      qualityRating: QualityRating.B,
      frequency: RenewalFrequency.MONTHLY,
      nextDueDate: new Date("2026-02-01"),
      fromMoneySourceId: "ms-a"
    });

    expect(result.ok).toBe(true);
    expect(prisma.recurringPayment.create).toHaveBeenCalled();
  });
});

describe("renewal transaction type contract", () => {
  it.each([TransactionType.REFUND, TransactionType.ADJUSTMENT])(
    "rejects creating a %s renewal before writes",
    async (transactionType) => {
      const result = await createRenewal({
        title: "Unsupported renewal",
        amount: 30,
        transactionType,
        frequency: RenewalFrequency.MONTHLY,
        nextDueDate: new Date("2026-02-01"),
        ...(transactionType === TransactionType.REFUND
          ? { toMoneySourceId: "ms-a" }
          : {})
      });

      expect(result).toEqual({
        ok: false,
        error: "Renewals support INCOME, EXPENSE, or TRANSFER only."
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.recurringPayment.create).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );

  it.each([TransactionType.REFUND, TransactionType.ADJUSTMENT])(
    "rejects updating a renewal to %s before writes",
    async (transactionType) => {
      const result = await updateRenewal("renewal-1", {
        transactionType,
        ...(transactionType === TransactionType.REFUND
          ? {
              fromMoneySourceId: undefined,
              toMoneySourceId: "ms-a"
            }
          : {})
      });

      expect(result).toEqual({
        ok: false,
        error: "Renewals support INCOME, EXPENSE, or TRANSFER only."
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.recurringPayment.updateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    }
  );
});

describe("createRenewal countTowardFeeWaiver defaults", () => {
  it.each([
    {
      name: "card expense",
      input: {
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: "ms-credit"
      },
      expected: true
    },
    {
      name: "excluded-category card expense",
      input: {
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: "ms-credit",
        categoryId: "category-excluded"
      },
      expected: false
    },
    {
      name: "bank expense",
      input: {
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: "ms-a"
      },
      expected: false
    },
    {
      name: "non-expense with an explicit true value",
      input: {
        transactionType: TransactionType.INCOME,
        toMoneySourceId: "ms-a",
        countTowardFeeWaiver: true
      },
      expected: false
    },
    {
      name: "card expense with an explicit false override",
      input: {
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: "ms-credit",
        countTowardFeeWaiver: false
      },
      expected: false
    },
    {
      name: "excluded-category card expense with an explicit true override",
      input: {
        transactionType: TransactionType.EXPENSE,
        fromMoneySourceId: "ms-credit",
        categoryId: "category-excluded",
        countTowardFeeWaiver: true
      },
      expected: true
    }
  ])("uses $expected for a $name", async ({ input, expected }) => {
    const result = await createRenewal({
      title: "Fee waiver renewal",
      amount: 30,
      frequency: RenewalFrequency.MONTHLY,
      nextDueDate: new Date("2026-02-01"),
      ...input
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.recurringPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          countTowardFeeWaiver: expected
        })
      })
    );
  });
});

function existingRenewalWithFeeWaiver(
  countTowardFeeWaiver: boolean
) {
  return {
    id: "renewal-1",
    userId: mockUser.id,
    title: "Card renewal",
    description: null,
    amount: 30 as any,
    currency: "VND",
    transactionType: TransactionType.EXPENSE,
    qualityRating: null,
    fromMoneySourceId: "ms-credit",
    toMoneySourceId: null,
    categoryId: null,
    projectId: null,
    countTowardFeeWaiver,
    frequency: RenewalFrequency.MONTHLY,
    intervalCount: 1,
    nextDueDate: new Date("2026-02-01"),
    reminderDaysBefore: 3,
    autoCreateTransaction: false,
    status: RenewalStatus.ACTIVE,
    lastGeneratedDate: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01")
  };
}

describe("renewal fee-waiver checkbox FormData contract", () => {
  it("treats a present sentinel with an unchecked create checkbox as false", async () => {
    const formData = new FormData();
    formData.set("title", "Unchecked card renewal");
    formData.set("amount", "30.00");
    formData.set("transactionType", TransactionType.EXPENSE);
    formData.set("fromMoneySourceId", "ms-credit");
    formData.set("frequency", RenewalFrequency.MONTHLY);
    formData.set("nextDueDate", "2026-02-01");
    formData.set("countTowardFeeWaiverPresent", "1");

    await expect(createRenewal(formData)).resolves.toEqual({ ok: true });
    expect(prisma.recurringPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ countTowardFeeWaiver: false })
      })
    );
  });

  it("treats a checked FormData checkbox as an explicit true override", async () => {
    const formData = new FormData();
    formData.set("title", "Checked excluded-category renewal");
    formData.set("amount", "30.00");
    formData.set("transactionType", TransactionType.EXPENSE);
    formData.set("fromMoneySourceId", "ms-credit");
    formData.set("categoryId", "category-excluded");
    formData.set("frequency", RenewalFrequency.MONTHLY);
    formData.set("nextDueDate", "2026-02-01");
    formData.set("countTowardFeeWaiverPresent", "1");
    formData.set("countTowardFeeWaiver", "on");

    await expect(createRenewal(formData)).resolves.toEqual({ ok: true });
    expect(prisma.recurringPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ countTowardFeeWaiver: true })
      })
    );
  });

  it("treats a present sentinel with an unchecked update checkbox as false", async () => {
    vi.mocked(prisma.recurringPayment.findFirst).mockResolvedValue(
      existingRenewalWithFeeWaiver(true)
    );
    const formData = new FormData();
    formData.set("countTowardFeeWaiverPresent", "1");

    await expect(updateRenewal("renewal-1", formData)).resolves.toEqual({
      ok: true
    });
    expect(prisma.recurringPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ countTowardFeeWaiver: false })
      })
    );
  });

  it("keeps the stored value when a partial FormData update truly omits both fields", async () => {
    vi.mocked(prisma.recurringPayment.findFirst).mockResolvedValue(
      existingRenewalWithFeeWaiver(true)
    );
    const formData = new FormData();
    formData.set("title", "Renamed card renewal");

    await expect(updateRenewal("renewal-1", formData)).resolves.toEqual({
      ok: true
    });
    expect(prisma.recurringPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ countTowardFeeWaiver: true })
      })
    );
  });
});
