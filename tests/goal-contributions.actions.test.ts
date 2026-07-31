import { ContributionType, Prisma, TransactionType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContribution,
  deleteContributionFormAction,
  updateContribution
} from "@/lib/actions/goal-contributions";
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

type FakeGoal = { id: string; userId: string; name: string };
type FakeTransaction = {
  id: string;
  userId: string;
  amount: number;
  title: string;
  type: TransactionType;
};
type FakeContribution = {
  id: string;
  savingGoalId: string;
  transactionId: string | null;
  fromMoneySourceId: string | null;
  amount: number;
  type: ContributionType;
  isManualAdjustment: boolean;
  note: string | null;
  contributionDate: Date;
  userId: string;
};

let goals: FakeGoal[];
let transactions: FakeTransaction[];
let contributions: FakeContribution[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (operation: any) =>
      operation((await import("@/lib/prisma")).prisma)
    ),
    savingGoal: {
      findFirst: vi.fn(async ({ where }: any) =>
        goals.find((g) => g.id === where.id && g.userId === where.userId) ?? null
      )
    },
    transaction: {
      findFirst: vi.fn(async ({ where }: any) =>
        transactions.find((t) => t.id === where.id && t.userId === where.userId) ?? null
      )
    },
    moneySource: {
      findFirst: vi.fn(async () => null)
    },
    goalContribution: {
      create: vi.fn(async ({ data }: any) => ({
        id: "new-contribution",
        savingGoalId: data.savingGoalId,
        amount: data.amount,
        type: data.type
      })),
      findFirst: vi.fn(async ({ where }: any) => {
        const contribution =
          contributions.find(
            (c) => c.id === where.id && c.userId === where.userId
          ) ?? null;
        return contribution ? { ...contribution } : null;
      }),
      aggregate: vi.fn(async ({ where }: any) => {
        // Mirrors real Prisma: excludes the row named in where.id.not, same as
        // validateLinkedTransactionLimit's excludeContributionId argument.
        const matches = contributions.filter((c) => {
          if (c.transactionId !== where.transactionId) return false;
          if (c.userId !== where.userId) return false;
          if (where.id?.not && c.id === where.id.not) return false;
          return true;
        });

        return {
          _sum: {
            amount: matches.length
              ? matches.reduce((total, c) => total + c.amount, 0)
              : null
          }
        };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const target = contributions.find(
          (c) => c.id === where.id && c.userId === where.userId
        );

        if (target) {
          Object.assign(target, data);
        }

        return { count: target ? 1 : 0 };
      })
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
  goals = [{ id: "g1", userId: "user-1", name: "Emergency Fund" }];
  transactions = [
    {
      id: "t1",
      userId: "user-1",
      amount: 100,
      title: "Paycheck",
      type: TransactionType.INCOME
    }
  ];
  contributions = [
    {
      id: "c1",
      savingGoalId: "g1",
      transactionId: "t1",
      fromMoneySourceId: null,
      amount: 100,
      type: ContributionType.CONTRIBUTION,
      isManualAdjustment: false,
      note: null,
      contributionDate: new Date("2026-01-01"),
      userId: "user-1"
    }
  ];
});

describe("updateContribution over-contribution guard", () => {
  it("returns a safe delete failure through the bound form action", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    await expect(deleteContributionFormAction("c1")).resolves.toEqual({
      ok: false,
      error: RATE_LIMIT_MESSAGE
    });
  });

  it("denies a rate-limited create before looking up contribution references", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await createContribution({
      savingGoalId: "g1",
      amount: "25.00",
      type: ContributionType.CONTRIBUTION,
      contributionDate: new Date("2026-01-02")
    });

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.savingGoal.findFirst).not.toHaveBeenCalled();
  });

  it("rejects raising a fully-allocated contribution above its linked transaction amount", async () => {
    const result = await updateContribution("c1", { amount: "500.00" });

    expect(result.ok).toBe(false);
    expect(contributions[0].amount).toBe(100);
  });

  it("allows editing an unrelated field on an already fully-allocated contribution", async () => {
    const result = await updateContribution("c1", { note: "renamed" });

    expect(result.ok).toBe(true);
    expect(contributions[0].note).toBe("renamed");
  });

  it("runs contribution validation, persistence, and activity in a serializable transaction", async () => {
    const result = await createContribution({
      savingGoalId: "g1",
      transactionId: "t1",
      amount: "0.01",
      type: ContributionType.CONTRIBUTION,
      contributionDate: new Date("2026-01-02"),
      isManualAdjustment: true
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      })
    );
  });

  it("retries P2034 conflicts no more than three times and returns a safe error", async () => {
    const conflict = () =>
      new Prisma.PrismaClientKnownRequestError("write conflict", {
        clientVersion: "6.19.0",
        code: "P2034"
      });
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict());

    const result = await createContribution({
      savingGoalId: "g1",
      transactionId: "t1",
      amount: "0.01",
      type: ContributionType.CONTRIBUTION,
      contributionDate: new Date("2026-01-02")
    });

    expect(result).toEqual({
      ok: false,
      error: "Unable to save contribution. Please try again."
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.goalContribution.create).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("writes exact §20.2 create metadata", async () => {
    await expect(
      createContribution({
        savingGoalId: "g1",
        amount: "25.00",
        type: ContributionType.CONTRIBUTION,
        contributionDate: new Date("2026-01-02")
      })
    ).resolves.toEqual({ ok: true });

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "GOAL_CONTRIBUTION_CREATED",
        entityType: "GoalContribution",
        entityId: "new-contribution",
        metadata: {
          goalId: "g1",
          amount: "25.00",
          type: ContributionType.CONTRIBUTION
        }
      }
    });
  });

  it("writes only persisted semantic changes on update", async () => {
    await expect(
      updateContribution("c1", { note: "renamed" })
    ).resolves.toEqual({ ok: true });

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "GOAL_CONTRIBUTION_UPDATED",
        entityType: "GoalContribution",
        entityId: "c1",
        metadata: {
          changedFields: {
            note: [null, "renamed"]
          }
        }
      }
    });
  });
});
