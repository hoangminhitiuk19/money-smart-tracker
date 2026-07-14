import { MoneySourceType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteMoneySource } from "@/lib/actions/money-sources";
import { prisma } from "@/lib/prisma";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

type FakeMoneySource = {
  id: string;
  userId: string;
  name: string;
  type: MoneySourceType;
};

let moneySources: FakeMoneySource[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    moneySource: {
      findFirst: vi.fn(async ({ where }: any) =>
        moneySources.find((m) => m.id === where.id && m.userId === where.userId) ?? null
      ),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = moneySources.length;
        moneySources = moneySources.filter(
          (m) => !(m.id === where.id && m.userId === where.userId)
        );
        return { count: before - moneySources.length };
      })
    },
    transaction: {
      count: vi.fn(async () => 0)
    },
    activityLog: {
      create: vi.fn(async () => ({}))
    }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  moneySources = [
    { id: "ms-1", userId: "user-1", name: "Cash Wallet", type: MoneySourceType.CASH }
  ];
});

describe("deleteMoneySource activity logging", () => {
  it("writes a MONEY_SOURCE_DELETED activity log entry", async () => {
    const result = await deleteMoneySource("ms-1");

    expect(result.ok).toBe(true);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          action: "MONEY_SOURCE_DELETED",
          entityId: "ms-1"
        })
      })
    );
  });
});
