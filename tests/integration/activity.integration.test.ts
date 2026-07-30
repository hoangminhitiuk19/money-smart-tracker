import { randomUUID } from "node:crypto";
import {
  CategoryType,
  ContributionType,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityRetentionCutoff,
  deleteExpiredActivity,
  retainedActivityWhere
} from "@/lib/activity";
import { updateCategory } from "@/lib/actions/categories";
import {
  createContribution,
  updateContribution
} from "@/lib/actions/goal-contributions";
import {
  createMoneySource,
  updateMoneySource
} from "@/lib/actions/money-sources";
import {
  createTransaction,
  updateTransaction
} from "@/lib/actions/transactions";
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
    email: "activity-audit@audit.invalid",
    name: "Activity audit user"
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

let context: AuditContext;

beforeAll(async () => {
  context = await createAuditContext(`activity-${randomUUID()}`);
  authState.userId = context.userA.id;
}, 20_000);

afterAll(async () => {
  await cleanupAuditContext(context);
  await prisma.$disconnect();
});

async function installActivityFailure(userId: string, action: string) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `fail_activity_${suffix}`;
  const triggerName = `fail_activity_trigger_${suffix}`;

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."userId" = '${userId}' AND NEW."action" = '${action}' THEN
        RAISE EXCEPTION 'forced activity failure';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "ActivityLog"
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);

  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "ActivityLog"`
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`
    );
  };
}

describe("activity mutation atomicity", () => {
  it("rolls back a money-source financial update when activity fails", async () => {
    const source = await prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: `Atomic source ${randomUUID()}`,
        type: MoneySourceType.BANK_ACCOUNT,
        openingBalance: "100.00"
      }
    });
    const uninstallFailure = await installActivityFailure(
      context.userA.id,
      "MONEY_SOURCE_UPDATED"
    );

    try {
      await expect(
        updateMoneySource(source.id, { openingBalance: "200.00" })
      ).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    const persisted = await prisma.moneySource.findUniqueOrThrow({
      where: { id: source.id }
    });
    expect(persisted.openingBalance.toFixed(2)).toBe("100.00");
  });

  it("rolls back a category domain update when activity fails", async () => {
    const category = await prisma.category.create({
      data: {
        userId: context.userA.id,
        name: `Atomic category ${randomUUID()}`,
        type: CategoryType.EXPENSE
      }
    });
    const uninstallFailure = await installActivityFailure(
      context.userA.id,
      "CATEGORY_UPDATED"
    );

    try {
      await expect(
        updateCategory(category.id, {
          name: "Changed category",
          type: CategoryType.EXPENSE
        })
      ).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    await expect(
      prisma.category.findUniqueOrThrow({ where: { id: category.id } })
    ).resolves.toMatchObject({ name: category.name });
  });

  it("rolls back a contribution amount update when activity fails", async () => {
    const goal = await prisma.savingGoal.create({
      data: {
        userId: context.userA.id,
        name: `Atomic contribution goal ${randomUUID()}`,
        targetAmount: "1000.00"
      }
    });
    const contribution = await prisma.goalContribution.create({
      data: {
        userId: context.userA.id,
        savingGoalId: goal.id,
        amount: "25.00",
        type: ContributionType.CONTRIBUTION,
        contributionDate: new Date("2026-07-30T00:00:00.000Z")
      }
    });
    const uninstallFailure = await installActivityFailure(
      context.userA.id,
      "GOAL_CONTRIBUTION_UPDATED"
    );

    try {
      await expect(
        updateContribution(contribution.id, { amount: "50.00" })
      ).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    const persisted = await prisma.goalContribution.findUniqueOrThrow({
      where: { id: contribution.id }
    });
    expect(persisted.amount.toFixed(2)).toBe("25.00");
  });
});

describe("§20.2 persisted metadata", () => {
  it("stores exact transaction create and semantic update metadata", async () => {
    const source = await prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: `Metadata source ${randomUUID()}`,
        type: MoneySourceType.BANK_ACCOUNT
      }
    });
    const title = `Metadata transaction ${randomUUID()}`;

    await expect(
      createTransaction({
        type: TransactionType.EXPENSE,
        amount: "100.00",
        title,
        transactionDate: "2026-07-30",
        fromMoneySourceId: source.id
      })
    ).resolves.toEqual({ ok: true });
    const transaction = await prisma.transaction.findFirstOrThrow({
      where: { userId: context.userA.id, title }
    });
    const created = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        action: "TRANSACTION_CREATED",
        entityId: transaction.id
      }
    });
    expect(created.metadata).toEqual({
      amount: "100.00",
      type: TransactionType.EXPENSE,
      title,
      fromSourceId: source.id,
      toSourceId: null
    });

    await expect(
      updateTransaction(transaction.id, { title: `${title} updated` })
    ).resolves.toEqual({ ok: true });
    const updated = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        action: "TRANSACTION_UPDATED",
        entityId: transaction.id
      }
    });
    expect(updated.metadata).toEqual({
      changedFields: {
        title: [title, `${title} updated`]
      }
    });
  });

  it("distinguishes money-source and credit-card semantic updates", async () => {
    const sourceName = `Metadata cash ${randomUUID()}`;
    await expect(
      createMoneySource({
        name: sourceName,
        type: MoneySourceType.CASH
      })
    ).resolves.toEqual({ ok: true });
    const source = await prisma.moneySource.findFirstOrThrow({
      where: { userId: context.userA.id, name: sourceName }
    });
    const created = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        action: "MONEY_SOURCE_CREATED",
        entityId: source.id
      }
    });
    expect(created.metadata).toEqual({
      name: sourceName,
      type: MoneySourceType.CASH
    });

    await expect(
      updateMoneySource(source.id, { name: `${sourceName} updated` })
    ).resolves.toEqual({ ok: true });
    const updated = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        action: "MONEY_SOURCE_UPDATED",
        entityId: source.id
      }
    });
    expect(updated.metadata).toEqual({
      changedFields: {
        name: [sourceName, `${sourceName} updated`]
      }
    });

    const card = await prisma.moneySource.create({
      data: {
        userId: context.userA.id,
        name: `Metadata card ${randomUUID()}`,
        type: MoneySourceType.CREDIT_CARD,
        creditLimit: "5000.00"
      }
    });
    await expect(
      updateMoneySource(card.id, { creditLimit: "6000.00" })
    ).resolves.toEqual({ ok: true });
    const cardUpdated = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        action: "CREDIT_CARD_UPDATED",
        entityId: card.id
      }
    });
    expect(cardUpdated.metadata).toEqual({
      changedFields: {
        creditLimit: ["5000.00", "6000.00"]
      }
    });
  });

  it("stores exact contribution create and semantic update metadata", async () => {
    const goal = await prisma.savingGoal.create({
      data: {
        userId: context.userA.id,
        name: `Metadata goal ${randomUUID()}`,
        targetAmount: "1000.00"
      }
    });
    await expect(
      createContribution({
        savingGoalId: goal.id,
        amount: "25.00",
        type: ContributionType.CONTRIBUTION,
        contributionDate: "2026-07-30"
      })
    ).resolves.toEqual({ ok: true });
    const contribution = await prisma.goalContribution.findFirstOrThrow({
      where: { userId: context.userA.id, savingGoalId: goal.id }
    });
    const created = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        action: "GOAL_CONTRIBUTION_CREATED",
        entityId: contribution.id
      }
    });
    expect(created.metadata).toEqual({
      goalId: goal.id,
      amount: "25.00",
      type: ContributionType.CONTRIBUTION
    });

    await expect(
      updateContribution(contribution.id, { note: "Audited" })
    ).resolves.toEqual({ ok: true });
    const updated = await prisma.activityLog.findFirstOrThrow({
      where: {
        userId: context.userA.id,
        action: "GOAL_CONTRIBUTION_UPDATED",
        entityId: contribution.id
      }
    });
    expect(updated.metadata).toEqual({
      changedFields: {
        note: [null, "Audited"]
      }
    });
  });
});

describe("activity retention", () => {
  it("filters at the inclusive 90-day boundary and deletes only 500 oldest expired IDs", async () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const cutoff = activityRetentionCutoff(now);
    const run = randomUUID();
    const expiredRows = Array.from({ length: 502 }, (_, index) => ({
      userId: context.userA.id,
      action: `RETENTION_EXPIRED_${run}_${index}`,
      entityType: "RetentionFixture",
      createdAt: new Date(cutoff.getTime() - (502 - index) * 1000)
    }));
    await prisma.activityLog.createMany({
      data: [
        ...expiredRows,
        {
          userId: context.userA.id,
          action: `RETENTION_BOUNDARY_${run}`,
          entityType: "RetentionFixture",
          createdAt: cutoff
        },
        {
          userId: context.userA.id,
          action: `RETENTION_CURRENT_${run}`,
          entityType: "RetentionFixture",
          createdAt: now
        },
        {
          userId: context.userB.id,
          action: `RETENTION_FOREIGN_CURRENT_${run}`,
          entityType: "RetentionFixture",
          createdAt: now
        }
      ]
    });

    const visibleBeforeCleanup = await prisma.activityLog.findMany({
      where: {
        ...retainedActivityWhere(context.userA.id, undefined, now),
        action: { startsWith: "RETENTION_" }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(visibleBeforeCleanup.map(({ action }) => action)).toEqual([
      `RETENTION_BOUNDARY_${run}`,
      `RETENTION_CURRENT_${run}`
    ]);

    await expect(deleteExpiredActivity(prisma, cutoff, 900)).resolves.toBe(500);

    const remainingExpired = await prisma.activityLog.findMany({
      where: {
        userId: context.userA.id,
        action: { startsWith: `RETENTION_EXPIRED_${run}_` },
        createdAt: { lt: cutoff }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(remainingExpired.map(({ action }) => action)).toEqual([
      `RETENTION_EXPIRED_${run}_500`,
      `RETENTION_EXPIRED_${run}_501`
    ]);
    await expect(
      prisma.activityLog.count({
        where: {
          action: {
            in: [
              `RETENTION_BOUNDARY_${run}`,
              `RETENTION_CURRENT_${run}`,
              `RETENTION_FOREIGN_CURRENT_${run}`
            ]
          }
        }
      })
    ).resolves.toBe(3);
  }, 30_000);
});
