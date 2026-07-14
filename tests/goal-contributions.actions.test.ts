import { ContributionType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateContribution } from "@/lib/actions/goal-contributions";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

type FakeGoal = { id: string; userId: string; name: string };
type FakeTransaction = { id: string; userId: string; amount: number; title: string };
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
      findFirst: vi.fn(async ({ where }: any) =>
        contributions.find((c) => c.id === where.id && c.userId === where.userId) ?? null
      ),
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
  goals = [{ id: "g1", userId: "user-1", name: "Emergency Fund" }];
  transactions = [{ id: "t1", userId: "user-1", amount: 100, title: "Paycheck" }];
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
  it("rejects raising a fully-allocated contribution above its linked transaction amount", async () => {
    const result = await updateContribution("c1", { amount: 500 });

    expect(result.ok).toBe(false);
    expect(contributions[0].amount).toBe(100);
  });

  it("allows editing an unrelated field on an already fully-allocated contribution", async () => {
    const result = await updateContribution("c1", { note: "renamed" });

    expect(result.ok).toBe(true);
    expect(contributions[0].note).toBe("renamed");
  });
});
