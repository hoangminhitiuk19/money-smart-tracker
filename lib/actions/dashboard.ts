"use server";

import { GoalStatus, MoneySourceType, RenewalStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import {
  calculateCreditCardState,
  calculateFeeWaiverState
} from "@/lib/calc/credit-card";
import { getDashboardSummary } from "@/lib/calc/dashboard";
import { calculateGoalProgress } from "@/lib/calc/goals";
import { calculateProjectSummary } from "@/lib/calc/projects";
import { isUpcomingRenewal } from "@/lib/calc/renewals";
import { transactionDateRange } from "@/lib/date-range";
import { prisma } from "@/lib/prisma";

function normalizeStartDate(date: Date | string) {
  return new Date(date);
}

function normalizeEndDate(date: Date | string) {
  return new Date(date);
}

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getThirtyDaysFrom(date: Date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 30);
  return result;
}

export async function getDashboardData(
  startDate: Date | string,
  endDate: Date | string
) {
  const user = await requireAuth();
  const userId = user.id;

  const periodStart = normalizeStartDate(startDate);
  const periodEnd = normalizeEndDate(endDate);
  const today = getToday();
  const renewalToday = new Date();
  const cardFeeWindowEnd = getThirtyDaysFrom(today);

  const [
    transactions,
    goals,
    projects,
    moneySources,
    activeRenewals,
    upcomingCardFees
  ] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        transactionDate: transactionDateRange(startDate, endDate)
      },
      orderBy: { transactionDate: "desc" }
    }),
    prisma.savingGoal.findMany({
      where: {
        userId,
        status: GoalStatus.ACTIVE
      },
      orderBy: [{ deadline: "asc" }, { name: "asc" }],
      include: {
        goalContributions: true
      }
    }),
    prisma.financialProject.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    }),
    prisma.moneySource.findMany({
      where: { userId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    }),
    prisma.recurringPayment.findMany({
      where: {
        userId,
        status: RenewalStatus.ACTIVE
      },
      orderBy: [{ nextDueDate: "asc" }, { title: "asc" }],
      include: {
        category: true,
        fromMoneySource: true,
        toMoneySource: true,
        project: true
      }
    }),
    prisma.moneySource.findMany({
      where: {
        userId,
        type: MoneySourceType.CREDIT_CARD,
        hasAnnualFee: true,
        annualFeeChargeDate: {
          gte: today,
          lte: cardFeeWindowEnd
        }
      },
      orderBy: { annualFeeChargeDate: "asc" }
    })
  ]);

  const upcomingRenewals = activeRenewals.filter((renewal) =>
    isUpcomingRenewal(renewal, renewalToday)
  );
  const summary = getDashboardSummary(
    transactions,
    goals,
    projects,
    moneySources,
    upcomingRenewals,
    today
  );
  const creditCards = moneySources
    .filter((source) => source.type === MoneySourceType.CREDIT_CARD)
    .map((source) => ({
      source,
      state: calculateCreditCardState(source, transactions)
    }));
  const feeWaivers = moneySources
    .filter(
      (source) =>
        source.type === MoneySourceType.CREDIT_CARD &&
        source.annualFeeWaiverEnabled
    )
    .map((source) => ({
      source,
      state: calculateFeeWaiverState(source, transactions)
    }));
  const goalProgress = goals.map((goal) => ({
    goal,
    progress: calculateGoalProgress(goal.goalContributions, goal.targetAmount)
  }));
  const projectSummaries = projects.map((project) => ({
    project,
    summary: calculateProjectSummary(
      transactions.filter((transaction) => transaction.projectId === project.id)
    )
  }));

  return {
    period: {
      startDate: periodStart,
      endDate: periodEnd
    },
    summary,
    transactions,
    goals: goalProgress,
    projects: projectSummaries,
    moneySources,
    creditCards,
    feeWaivers,
    renewals: {
      upcoming: upcomingRenewals
    },
    cardFees: {
      upcoming: upcomingCardFees
    }
  };
}
