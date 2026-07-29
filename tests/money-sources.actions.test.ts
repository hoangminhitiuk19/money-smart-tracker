import { MoneySourceType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMoneySource,
  deleteMoneySource,
  toggleMoneySourceActiveFormAction
} from "@/lib/actions/money-sources";
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

type FakeMoneySource = {
  id: string;
  userId: string;
  name: string;
  type: MoneySourceType;
  isActive: boolean;
};

let moneySources: FakeMoneySource[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    moneySource: {
      findFirst: vi.fn(async ({ where }: any) =>
        moneySources.find((m) => m.id === where.id && m.userId === where.userId) ?? null
      ),
      create: vi.fn(async ({ data }: any) => {
        const record = { id: "new-money-source", ...data };
        moneySources.push(record);
        return { id: record.id, name: record.name, type: record.type };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const target = moneySources.find(
          (m) => m.id === where.id && m.userId === where.userId
        );

        if (target) {
          Object.assign(target, data);
        }

        return { count: target ? 1 : 0 };
      }),
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
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
  moneySources = [
    {
      id: "ms-1",
      userId: "user-1",
      name: "Cash Wallet",
      type: MoneySourceType.CASH,
      isActive: true
    }
  ];
});

describe("deleteMoneySource activity logging", () => {
  it("denies a rate-limited create before creating a money source", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await createMoneySource({
      name: "Savings",
      type: MoneySourceType.BANK_ACCOUNT
    });

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.moneySource.create).not.toHaveBeenCalled();
  });

  it("consumes one rate-limit token when toggling a money source", async () => {
    await toggleMoneySourceActiveFormAction("ms-1", false, new FormData());

    expect(checkAuthenticatedMutation).toHaveBeenCalledTimes(1);
    expect(checkAuthenticatedMutation).toHaveBeenCalledWith("user-1");
  });

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
