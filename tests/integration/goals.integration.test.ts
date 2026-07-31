import { randomUUID } from "node:crypto";
import {
  ContributionType,
  GoalStatus,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createContribution,
  deleteContribution,
  updateContribution
} from "@/lib/actions/goal-contributions";
import {
  createGoal,
  deleteGoal,
  updateGoal
} from "@/lib/actions/goals";
import { overContributionError } from "@/lib/calc/goals";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "goal-audit@audit.invalid",
    name: "Goal audit user"
  }))
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

type Fixtures = {
  context: AuditContext;
  goalAId: string;
  goalBId: string;
  incomeAId: string;
  incomeBId: string;
  expenseAId: string;
  sourceAId: string;
  sourceBId: string;
};

type ContributionInput = Parameters<typeof createContribution>[0];

const contexts: AuditContext[] = [];
let fixtures: Fixtures;

beforeAll(async () => {
  const context = await createAuditContext(`goals-${randomUUID()}`);
  contexts.push(context);

  const [sourceA, sourceB, goalA, goalB] = await prisma.$transaction([
    prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: "Goal audit savings A",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.moneySource.create({
      data: {
        userId: context.userB.id,
        name: "Goal audit savings B",
        type: MoneySourceType.BANK_ACCOUNT
      }
    }),
    prisma.savingGoal.create({
      data: {
        userId: context.userA.id,
        name: "Goal audit fund A",
        targetAmount: "1000000.00"
      }
    }),
    prisma.savingGoal.create({
      data: {
        userId: context.userB.id,
        name: "Goal audit fund B",
        targetAmount: "1000000.00"
      }
    })
  ]);

  const [incomeA, incomeB, expenseA] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.INCOME,
        amount: "1000.00",
        title: "Goal audit income A",
        transactionDate: new Date("2026-07-01T00:00:00.000Z"),
        toMoneySourceId: sourceA.id
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userB.id,
        type: TransactionType.INCOME,
        amount: "1000.00",
        title: "Goal audit income B",
        transactionDate: new Date("2026-07-01T00:00:00.000Z"),
        toMoneySourceId: sourceB.id
      }
    }),
    prisma.transaction.create({
      data: {
        userId: context.userA.id,
        type: TransactionType.EXPENSE,
        amount: "1000.00",
        title: "Goal audit expense A",
        transactionDate: new Date("2026-07-02T00:00:00.000Z"),
        fromMoneySourceId: sourceA.id
      }
    })
  ]);

  fixtures = {
    context,
    goalAId: goalA.id,
    goalBId: goalB.id,
    incomeAId: incomeA.id,
    incomeBId: incomeB.id,
    expenseAId: expenseA.id,
    sourceAId: sourceA.id,
    sourceBId: sourceB.id
  };
  authState.userId = context.userA.id;
}, 20_000);

afterAll(async () => {
  await Promise.all(contexts.map(cleanupAuditContext));
  await prisma.$disconnect();
});

async function createOwnedIncome(amount: string) {
  return prisma.transaction.create({
    data: {
      userId: fixtures.context.userA.id,
      type: TransactionType.INCOME,
      amount,
      title: `Goal audit income ${randomUUID()}`,
      transactionDate: new Date("2026-07-03T00:00:00.000Z"),
      toMoneySourceId: fixtures.sourceAId
    }
  });
}

function linkedContribution(
  transactionId: string,
  amount: string,
  overrides: Partial<ContributionInput> = {}
): ContributionInput {
  return {
    savingGoalId: fixtures.goalAId,
    transactionId,
    amount,
    type: ContributionType.CONTRIBUTION,
    contributionDate: "2026-07-04",
    ...overrides
  };
}

async function writeCounts() {
  const [contributions, activities] = await Promise.all([
    prisma.goalContribution.count({
      where: { userId: fixtures.context.userA.id }
    }),
    prisma.activityLog.count({
      where: { userId: fixtures.context.userA.id }
    })
  ]);

  return { activities, contributions };
}

async function expectRejectedWithoutWrites(
  input: ContributionInput,
  expectedError?: string
) {
  const before = await writeCounts();
  const result = await createContribution(input);

  expect(result.ok).toBe(false);
  if (expectedError) {
    expect(result.error).toBe(expectedError);
  }
  await expect(writeCounts()).resolves.toEqual(before);
}

describe("goal contribution persistence", () => {
  it(
    "accepts the exact remaining 200.00 and rejects 200.01 without writes",
    async () => {
      const acceptedIncome = await createOwnedIncome("300.00");
      await prisma.goalContribution.create({
        data: {
          userId: fixtures.context.userA.id,
          savingGoalId: fixtures.goalAId,
          transactionId: acceptedIncome.id,
          amount: "100.00",
          type: ContributionType.CONTRIBUTION,
          contributionDate: new Date("2026-07-03T00:00:00.000Z")
        }
      });

      await expect(
        createContribution(linkedContribution(acceptedIncome.id, "200.00"))
      ).resolves.toEqual({ ok: true });
      const acceptedTotal = await prisma.goalContribution.aggregate({
        where: {
          userId: fixtures.context.userA.id,
          transactionId: acceptedIncome.id
        },
        _sum: { amount: true }
      });
      expect(acceptedTotal._sum.amount?.toFixed(2)).toBe("300.00");

      const rejectedIncome = await createOwnedIncome("300.00");
      await prisma.goalContribution.create({
        data: {
          userId: fixtures.context.userA.id,
          savingGoalId: fixtures.goalAId,
          transactionId: rejectedIncome.id,
          amount: "100.00",
          type: ContributionType.CONTRIBUTION,
          contributionDate: new Date("2026-07-03T00:00:00.000Z")
        }
      });

      await expectRejectedWithoutWrites(
        linkedContribution(rejectedIncome.id, "200.01"),
        overContributionError
      );
    },
    20_000
  );

  it("persists an unlinked contribution without losing Decimal precision", async () => {
    const note = `exact-${randomUUID()}`;

    await expect(
      createContribution({
        savingGoalId: fixtures.goalAId,
        amount: "90071992547409.99",
        type: ContributionType.CONTRIBUTION,
        contributionDate: "2026-07-05",
        note
      })
    ).resolves.toEqual({ ok: true });

    const contribution = await prisma.goalContribution.findFirstOrThrow({
      where: {
        userId: fixtures.context.userA.id,
        note
      }
    });
    expect(contribution.amount.toFixed(2)).toBe("90071992547409.99");
  });

  it("counts a manual override in later linked allocation totals", async () => {
    const income = await createOwnedIncome("100.00");

    await expect(
      createContribution(
        linkedContribution(income.id, "120.00", {
          isManualAdjustment: true
        })
      )
    ).resolves.toEqual({ ok: true });

    await expectRejectedWithoutWrites(
      linkedContribution(income.id, "0.01"),
      overContributionError
    );
  });

  it("rejects non-income and withdrawal links without contribution or activity writes", async () => {
    await expectRejectedWithoutWrites(
      linkedContribution(fixtures.expenseAId, "10.00")
    );
    await expectRejectedWithoutWrites(
      linkedContribution(fixtures.incomeAId, "10.00", {
        type: ContributionType.WITHDRAWAL
      })
    );
  });

  it("rejects every foreign reference without contribution or activity writes", async () => {
    await expectRejectedWithoutWrites({
      savingGoalId: fixtures.goalBId,
      amount: "10.00",
      type: ContributionType.CONTRIBUTION,
      contributionDate: "2026-07-06"
    });
    await expectRejectedWithoutWrites(
      linkedContribution(fixtures.incomeBId, "10.00")
    );
    await expectRejectedWithoutWrites({
      savingGoalId: fixtures.goalAId,
      fromMoneySourceId: fixtures.sourceBId,
      amount: "10.00",
      type: ContributionType.CONTRIBUTION,
      contributionDate: "2026-07-06"
    });
  });

  it("commits exactly one concurrent 60.00 allocation against 100.00", async () => {
    const income = await createOwnedIncome("100.00");

    const results = await Promise.all([
      createContribution(linkedContribution(income.id, "60.00")),
      createContribution(linkedContribution(income.id, "60.00"))
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);

    const [committed, activityCount] = await Promise.all([
      prisma.goalContribution.aggregate({
        where: {
          userId: fixtures.context.userA.id,
          transactionId: income.id
        },
        _sum: { amount: true }
      }),
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "GOAL_CONTRIBUTION_CREATED",
          entityType: "GoalContribution",
          entityId: {
            in: (
              await prisma.goalContribution.findMany({
                where: {
                  userId: fixtures.context.userA.id,
                  transactionId: income.id
                },
                select: { id: true }
              })
            ).map(({ id }) => id)
          }
        }
      })
    ]);

    expect(committed._sum.amount?.toFixed(2)).toBe("60.00");
    expect(activityCount).toBe(1);
  }, 20_000);

  it("supports unlinked withdrawals and records their activity atomically", async () => {
    const before = await writeCounts();

    await expect(
      createContribution({
        savingGoalId: fixtures.goalAId,
        amount: "25.00",
        type: ContributionType.WITHDRAWAL,
        contributionDate: "2026-07-07"
      })
    ).resolves.toEqual({ ok: true });

    await expect(writeCounts()).resolves.toEqual({
      activities: before.activities + 1,
      contributions: before.contributions + 1
    });
  });

  it("updates and deletes a contribution together with matching activity", async () => {
    const note = `contribution-crud-${randomUUID()}`;
    await expect(
      createContribution({
        savingGoalId: fixtures.goalAId,
        amount: "40.00",
        type: ContributionType.CONTRIBUTION,
        contributionDate: "2026-07-08",
        note
      })
    ).resolves.toEqual({ ok: true });
    const contribution = await prisma.goalContribution.findFirstOrThrow({
      where: { userId: fixtures.context.userA.id, note }
    });

    await expect(
      updateContribution(contribution.id, {
        amount: "15.00",
        type: ContributionType.WITHDRAWAL
      })
    ).resolves.toEqual({ ok: true });
    const updated = await prisma.goalContribution.findUniqueOrThrow({
      where: { id: contribution.id }
    });
    expect(updated.amount.toFixed(2)).toBe("15.00");
    expect(updated.type).toBe(ContributionType.WITHDRAWAL);
    expect(updated.transactionId).toBeNull();
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "GOAL_CONTRIBUTION_UPDATED",
          entityId: contribution.id
        }
      })
    ).resolves.toBe(1);

    await expect(deleteContribution(contribution.id)).resolves.toEqual({
      ok: true
    });
    await expect(
      prisma.goalContribution.count({ where: { id: contribution.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "GOAL_CONTRIBUTION_DELETED",
          entityId: contribution.id
        }
      })
    ).resolves.toBe(1);
  });
});

describe("saving goal mutation activity", () => {
  it("creates, updates, and deletes each goal with its matching activity", async () => {
    const name = `Atomic goal ${randomUUID()}`;

    await expect(
      createGoal({
        name,
        targetAmount: "5000.00",
        status: GoalStatus.ACTIVE
      })
    ).resolves.toEqual({ ok: true });
    const goal = await prisma.savingGoal.findFirstOrThrow({
      where: { userId: fixtures.context.userA.id, name }
    });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "GOAL_CREATED",
          entityId: goal.id
        }
      })
    ).resolves.toBe(1);

    await expect(
      updateGoal(goal.id, { status: GoalStatus.PAUSED })
    ).resolves.toEqual({ ok: true });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "GOAL_UPDATED",
          entityId: goal.id
        }
      })
    ).resolves.toBe(1);

    await expect(deleteGoal(goal.id)).resolves.toEqual({ ok: true });
    await expect(
      prisma.savingGoal.count({ where: { id: goal.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.activityLog.count({
        where: {
          userId: fixtures.context.userA.id,
          action: "GOAL_DELETED",
          entityId: goal.id
        }
      })
    ).resolves.toBe(1);
  });
});
