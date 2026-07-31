import { GoalStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoal, deleteGoalFormAction } from "@/lib/actions/goals";
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (operation: any) =>
      operation((await import("@/lib/prisma")).prisma)
    ),
    savingGoal: {
      create: vi.fn(async ({ data }: any) => ({
        id: "new-goal",
        name: data.name,
        status: data.status,
        targetAmount: data.targetAmount
      }))
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
});

describe("goal mutation rate limiting", () => {
  it("returns a safe delete failure through the bound form action", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    await expect(deleteGoalFormAction("goal-1")).resolves.toEqual({
      ok: false,
      error: RATE_LIMIT_MESSAGE
    });
  });

  it("denies a rate-limited create before creating a saving goal", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await createGoal({
      name: "Emergency fund",
      targetAmount: "1000000.00",
      status: GoalStatus.ACTIVE
    });

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.savingGoal.create).not.toHaveBeenCalled();
  });

  it("creates a goal and its activity inside one database transaction", async () => {
    const result = await createGoal({
      name: "Emergency fund",
      targetAmount: "1000000.00",
      status: GoalStatus.ACTIVE
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });
});
