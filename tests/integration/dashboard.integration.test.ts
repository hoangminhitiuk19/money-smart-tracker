import { randomUUID } from "node:crypto";
import {
  CategoryType,
  ContributionType,
  GoalStatus,
  MoneySourceType,
  RenewalFrequency,
  RenewalStatus,
  TransactionType,
  WaiverPeriod
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDashboardData } from "@/lib/actions/dashboard";
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
    email: "dashboard-audit@audit.invalid",
    name: "Dashboard audit user"
  }))
}));

let context: AuditContext;

beforeAll(async () => {
  context = await createAuditContext(`dashboard-${randomUUID()}`);
  authState.userId = context.userA.id;
}, 20_000);

afterAll(async () => {
  await cleanupAuditContext(context);
  await prisma.$disconnect();
});

describe("dashboard data horizons", () => {
  it("uses the selected period for expense and the complete ledger for current state", async () => {
    const [bank, card] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: "Dashboard bank",
          openingBalance: "2000.00",
          type: MoneySourceType.BANK_ACCOUNT
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: "Dashboard card",
          creditLimit: "1000.00",
          type: MoneySourceType.CREDIT_CARD
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: "Excluded dashboard source",
          openingBalance: "999.00",
          type: MoneySourceType.OTHER
        }
      })
    ]);

    await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.INCOME,
          amount: "820.00",
          title: "Prior-period income",
          transactionDate: new Date("2026-05-01T00:00:00.000Z"),
          toMoneySourceId: bank.id
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.EXPENSE,
          amount: "200.00",
          title: "Prior-period card expense",
          transactionDate: new Date("2026-05-02T00:00:00.000Z"),
          fromMoneySourceId: card.id
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.TRANSFER,
          amount: "115.00",
          title: "Prior-period card payment",
          transactionDate: new Date("2026-06-01T00:00:00.000Z"),
          fromMoneySourceId: bank.id,
          toMoneySourceId: card.id
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userA.id,
          type: TransactionType.EXPENSE,
          amount: "100.00",
          title: "Selected-period expense",
          transactionDate: new Date("2026-07-10T00:00:00.000Z"),
          fromMoneySourceId: bank.id
        }
      })
    ]);

    const result = await getDashboardData("2026-07-01", "2026-07-31");

    expect(result.summary.totalExpense.toFixed(2)).toBe("100.00");
    expect(result.summary.estimatedNetPosition.toFixed(2)).toBe("2520.00");
    expect(result.creditCards[0].state.outstandingDebt.toFixed(2)).toBe("85.00");
  }, 20_000);

  it("keeps every period and domain horizon scoped to the authenticated user", async () => {
    authState.userId = context.userB.id;
    const today = new Date();
    const renewalDueDate = new Date(today);
    renewalDueDate.setDate(renewalDueDate.getDate() + 2);
    const farRenewalDueDate = new Date(today);
    farRenewalDueDate.setDate(farRenewalDueDate.getDate() + 20);
    const annualFeeChargeDate = new Date(today);
    annualFeeChargeDate.setDate(annualFeeChargeDate.getDate() + 20);

    const [bank, card, inactiveCard, activeGoal] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: context.userB.id,
          name: "Isolated dashboard bank",
          openingBalance: "50.00",
          type: MoneySourceType.BANK_ACCOUNT
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userB.id,
          name: "Isolated dashboard card",
          annualFeeAmount: "25.00",
          annualFeeChargeDate,
          annualFeeCurrency: "VND",
          annualFeeWaiverEnabled: true,
          annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
          annualFeeWaiverSpendTarget: "500.00",
          creditLimit: "1000.00",
          hasAnnualFee: true,
          type: MoneySourceType.CREDIT_CARD,
          waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
          waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z")
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userB.id,
          name: "Inactive dashboard card",
          annualFeeWaiverEnabled: true,
          annualFeeWaiverPeriod: WaiverPeriod.YEARLY,
          annualFeeWaiverSpendTarget: "500.00",
          creditLimit: "1000.00",
          initialOutstandingDebt: "30.00",
          isActive: false,
          type: MoneySourceType.CREDIT_CARD,
          waiverPeriodEndDate: new Date("2026-12-31T00:00:00.000Z"),
          waiverPeriodStartDate: new Date("2026-01-01T00:00:00.000Z")
        }
      }),
      prisma.savingGoal.create({
        data: {
          userId: context.userB.id,
          name: "Isolated active goal",
          targetAmount: "1000.00"
        }
      }),
      prisma.savingGoal.create({
        data: {
          userId: context.userB.id,
          name: "Isolated paused goal",
          status: GoalStatus.PAUSED,
          targetAmount: "1000.00"
        }
      })
    ]);

    const [waiverExpense, periodExpense] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: context.userB.id,
          type: TransactionType.EXPENSE,
          amount: "40.00",
          title: "Prior waiver-cycle expense",
          countTowardFeeWaiver: true,
          transactionDate: new Date("2026-05-10T00:00:00.000Z"),
          fromMoneySourceId: card.id
        }
      }),
      prisma.transaction.create({
        data: {
          userId: context.userB.id,
          type: TransactionType.EXPENSE,
          amount: "10.00",
          title: "Isolated selected-period expense",
          transactionDate: new Date("2026-07-12T00:00:00.000Z"),
          fromMoneySourceId: bank.id
        }
      }),
      prisma.goalContribution.create({
        data: {
          userId: context.userB.id,
          savingGoalId: activeGoal.id,
          amount: "300.00",
          type: ContributionType.CONTRIBUTION,
          contributionDate: new Date("2026-05-15T00:00:00.000Z")
        }
      }),
      prisma.goalContribution.create({
        data: {
          userId: context.userA.id,
          savingGoalId: activeGoal.id,
          amount: "700.00",
          type: ContributionType.CONTRIBUTION,
          contributionDate: new Date("2026-05-16T00:00:00.000Z")
        }
      }),
      prisma.recurringPayment.create({
        data: {
          userId: context.userB.id,
          title: "Isolated upcoming renewal",
          amount: "15.00",
          transactionType: TransactionType.EXPENSE,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: renewalDueDate,
          reminderDaysBefore: 3,
          status: RenewalStatus.ACTIVE,
          fromMoneySourceId: bank.id
        }
      }),
      prisma.recurringPayment.create({
        data: {
          userId: context.userB.id,
          title: "Isolated far renewal",
          amount: "20.00",
          transactionType: TransactionType.EXPENSE,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: farRenewalDueDate,
          reminderDaysBefore: 3,
          status: RenewalStatus.ACTIVE,
          fromMoneySourceId: bank.id
        }
      })
    ]);

    const result = await getDashboardData("2026-07-01", "2026-07-31");

    expect(result.summary.totalExpense.toFixed(2)).toBe("10.00");
    expect(result.transactions.map(({ id }) => id)).toEqual([periodExpense.id]);
    expect(result.transactions.map(({ id }) => id)).not.toContain(
      waiverExpense.id
    );
    expect(result.moneySources.every(({ userId }) => userId === context.userB.id)).toBe(
      true
    );
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].progress.netContributed.toFixed(2)).toBe("300.00");
    expect(result.summary.estimatedNetPosition.toFixed(2)).toBe("-30.00");
    expect(result.creditCards.map(({ source }) => source.id)).toEqual([card.id]);
    expect(result.creditCards.map(({ source }) => source.id)).not.toContain(
      inactiveCard.id
    );
    expect(result.feeWaivers.map(({ source }) => source.id)).toEqual([card.id]);
    expect(result.feeWaivers[0].state.eligibleSpending.toFixed(2)).toBe(
      "40.00"
    );
    expect(result.renewals.upcoming.map(({ title }) => title)).toEqual([
      "Isolated upcoming renewal"
    ]);
    expect(result.cardFees.upcoming.map(({ id }) => id)).toEqual([card.id]);
  }, 20_000);

  it("returns owned renewal roots without leaking poisoned foreign relations", async () => {
    authState.userId = context.userA.id;
    const today = new Date();
    const poisonedDueDate = new Date(today);
    poisonedDueDate.setDate(poisonedDueDate.getDate() + 1);
    const validDueDate = new Date(today);
    validDueDate.setDate(validDueDate.getDate() + 2);

    const [
      ownedSource,
      foreignFromSource,
      foreignToSource,
      foreignCategory,
      foreignProject
    ] = await prisma.$transaction([
      prisma.moneySource.create({
        data: {
          userId: context.userA.id,
          name: "Owned renewal source",
          type: MoneySourceType.BANK_ACCOUNT
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userB.id,
          name: "Foreign renewal source from",
          type: MoneySourceType.BANK_ACCOUNT
        }
      }),
      prisma.moneySource.create({
        data: {
          userId: context.userB.id,
          name: "Foreign renewal source to",
          type: MoneySourceType.E_WALLET
        }
      }),
      prisma.category.create({
        data: {
          userId: context.userB.id,
          name: "Foreign renewal category",
          type: CategoryType.EXPENSE
        }
      }),
      prisma.financialProject.create({
        data: {
          userId: context.userB.id,
          name: "Foreign renewal project"
        }
      })
    ]);

    const [poisonedRenewal, validRenewal] = await prisma.$transaction([
      prisma.recurringPayment.create({
        data: {
          userId: context.userA.id,
          title: "Owned poisoned renewal",
          amount: "25.00",
          transactionType: TransactionType.TRANSFER,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: poisonedDueDate,
          reminderDaysBefore: 3,
          categoryId: foreignCategory.id,
          fromMoneySourceId: foreignFromSource.id,
          toMoneySourceId: foreignToSource.id,
          projectId: foreignProject.id
        }
      }),
      prisma.recurringPayment.create({
        data: {
          userId: context.userA.id,
          title: "Owned valid renewal",
          amount: "15.00",
          transactionType: TransactionType.EXPENSE,
          frequency: RenewalFrequency.MONTHLY,
          nextDueDate: validDueDate,
          reminderDaysBefore: 3,
          fromMoneySourceId: ownedSource.id
        }
      })
    ]);

    const result = await getDashboardData("2026-07-01", "2026-07-31");
    const upcomingById = new Map(
      result.renewals.upcoming.map((renewal) => [renewal.id, renewal])
    );

    expect(upcomingById.get(validRenewal.id)).toMatchObject({
      id: validRenewal.id,
      title: "Owned valid renewal",
      currency: "VND",
      amount: validRenewal.amount,
      nextDueDate: validRenewal.nextDueDate,
      reminderDaysBefore: 3
    });
    expect(upcomingById.has(poisonedRenewal.id)).toBe(true);
    expect(result.renewals.upcoming.map(({ title }) => title)).toEqual([
      "Owned poisoned renewal",
      "Owned valid renewal"
    ]);

    for (const renewal of result.renewals.upcoming) {
      expect("category" in renewal).toBe(false);
      expect("categoryId" in renewal).toBe(false);
      expect("fromMoneySource" in renewal).toBe(false);
      expect("fromMoneySourceId" in renewal).toBe(false);
      expect("toMoneySource" in renewal).toBe(false);
      expect("toMoneySourceId" in renewal).toBe(false);
      expect("project" in renewal).toBe(false);
      expect("projectId" in renewal).toBe(false);
    }

    const serializedUpcoming = JSON.stringify(result.renewals.upcoming);
    expect(serializedUpcoming).not.toContain("Isolated upcoming renewal");
    expect(serializedUpcoming).not.toContain("Foreign renewal category");
    expect(serializedUpcoming).not.toContain("Foreign renewal source");
    expect(serializedUpcoming).not.toContain("Foreign renewal project");
  }, 20_000);
});
