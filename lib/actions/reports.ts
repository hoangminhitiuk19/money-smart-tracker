"use server";

import {
  MoneySourceType,
  RenewalStatus,
  TransactionType
} from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import {
  calculateCreditCardState,
  calculateFeeWaiverState
} from "@/lib/calc/credit-card";
import { calculateGoalProgress } from "@/lib/calc/goals";
import {
  getExpenseByCategory,
  getIncomeVsExpenseOverTime,
  getProjectProfitLoss,
  getRecurringExpensePerMonth,
  getSpendingBySource,
  getSpendingQualityBreakdown,
  getUpcomingRenewalsTotal,
  type ReportGroupBy
} from "@/lib/calc/reports";
import { prisma } from "@/lib/prisma";

function normalizeDate(date: Date | string) {
  return new Date(date);
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

async function getSessionUserId() {
  const user = await requireAuth();

  return user.id;
}

async function getTransactionsInRange(
  userId: string,
  startDate: Date | string,
  endDate: Date | string
) {
  return prisma.transaction.findMany({
    where: {
      userId,
      transactionDate: {
        gte: normalizeDate(startDate),
        lte: normalizeDate(endDate)
      }
    },
    orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
  });
}

export async function loadIncomeVsExpenseOverTime(
  startDate: Date | string,
  endDate: Date | string,
  groupBy: ReportGroupBy
) {
  const scopedUserId = await getSessionUserId();
  const transactions = await getTransactionsInRange(
    scopedUserId,
    startDate,
    endDate
  );

  return getIncomeVsExpenseOverTime(transactions, groupBy);
}

export async function loadExpenseByCategory(
  startDate: Date | string,
  endDate: Date | string
) {
  const scopedUserId = await getSessionUserId();
  const [transactions, categories] = await Promise.all([
    getTransactionsInRange(scopedUserId, startDate, endDate),
    prisma.category.findMany({
      where: { userId: scopedUserId },
      orderBy: { name: "asc" }
    })
  ]);

  return getExpenseByCategory(transactions, categories);
}

export async function loadSpendingQualityBreakdown(
  startDate: Date | string,
  endDate: Date | string
) {
  const scopedUserId = await getSessionUserId();
  const transactions = await getTransactionsInRange(
    scopedUserId,
    startDate,
    endDate
  );

  return getSpendingQualityBreakdown(transactions);
}

export async function loadGoalProgressReport() {
  const scopedUserId = await getSessionUserId();
  const goals = await prisma.savingGoal.findMany({
    where: { userId: scopedUserId },
    orderBy: [{ status: "asc" }, { deadline: "asc" }, { name: "asc" }],
    include: {
      goalContributions: true
    }
  });

  return goals.map((goal) => ({
    goal,
    progress: calculateGoalProgress(goal.goalContributions, goal.targetAmount)
  }));
}

export async function loadProjectProfitLoss() {
  const scopedUserId = await getSessionUserId();
  const [projects, transactions] = await Promise.all([
    prisma.financialProject.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    }),
    prisma.transaction.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    })
  ]);

  return getProjectProfitLoss(transactions, projects);
}

export async function loadSpendingBySource(
  startDate: Date | string,
  endDate: Date | string
) {
  const scopedUserId = await getSessionUserId();
  const [transactions, sources] = await Promise.all([
    getTransactionsInRange(scopedUserId, startDate, endDate),
    prisma.moneySource.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    })
  ]);

  return getSpendingBySource(transactions, sources);
}

export async function loadCreditCardDebtReport() {
  const scopedUserId = await getSessionUserId();
  const [creditCards, transactions] = await Promise.all([
    prisma.moneySource.findMany({
      where: {
        userId: scopedUserId,
        type: MoneySourceType.CREDIT_CARD
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    }),
    prisma.transaction.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    })
  ]);

  return creditCards.map((source) => ({
    source,
    state: calculateCreditCardState(source, transactions)
  }));
}

export async function loadFeeWaiverReport() {
  const scopedUserId = await getSessionUserId();
  const [creditCards, transactions] = await Promise.all([
    prisma.moneySource.findMany({
      where: {
        userId: scopedUserId,
        type: MoneySourceType.CREDIT_CARD,
        annualFeeWaiverEnabled: true
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    }),
    prisma.transaction.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
    })
  ]);

  return creditCards.map((source) => ({
    source,
    state: calculateFeeWaiverState(source, transactions)
  }));
}

export async function loadUpcomingRenewalsTotal(
  months: number
) {
  const scopedUserId = await getSessionUserId();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addMonths(today, months);
  const renewals = await prisma.recurringPayment.findMany({
    where: {
      userId: scopedUserId,
      status: RenewalStatus.ACTIVE,
      nextDueDate: {
        gte: today,
        lte: endDate
      }
    },
    orderBy: [{ nextDueDate: "asc" }, { title: "asc" }]
  });

  return {
    ...getUpcomingRenewalsTotal(renewals),
    renewals
  };
}

export async function loadRecurringExpensePerMonth(
  startDate: Date | string,
  endDate: Date | string
) {
  const scopedUserId = await getSessionUserId();
  const renewals = await prisma.recurringPayment.findMany({
    where: {
      userId: scopedUserId,
      status: RenewalStatus.ACTIVE,
      transactionType: TransactionType.EXPENSE,
      nextDueDate: {
        gte: normalizeDate(startDate),
        lte: normalizeDate(endDate)
      }
    },
    orderBy: [{ nextDueDate: "asc" }, { title: "asc" }]
  });

  return getRecurringExpensePerMonth(renewals);
}
