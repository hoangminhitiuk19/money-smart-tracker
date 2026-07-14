import { QualityRating, RenewalFrequency, TransactionType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRenewal } from "@/lib/actions/renewals";
import { prisma } from "@/lib/prisma";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findFirst: vi.fn(async () => null) },
    financialProject: { findFirst: vi.fn(async () => null) },
    moneySource: {
      findMany: vi.fn(async ({ where }: any) =>
        where.id.in.map((id: string) => ({ id }))
      )
    },
    recurringPayment: {
      create: vi.fn(async ({ data }: any) => ({
        id: "new-renewal",
        title: data.title,
        amount: data.amount,
        status: data.status
      }))
    },
    activityLog: { create: vi.fn(async () => ({})) }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
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
