"use server";

import {
  MoneySourceType,
  QualityRating,
  RenewalStatus,
  TransactionType,
  type Prisma
} from "@prisma/client";
import { z } from "zod";
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
import { transactionDateRange } from "@/lib/date-range";
import { prisma } from "@/lib/prisma";

export type ReportFilters = {
  startDate?: Date | string;
  endDate?: Date | string;
  type?: TransactionType;
  categoryId?: string;
  qualityRating?: QualityRating;
  moneySourceId?: string;
  projectId?: string;
  savingGoalId?: string;
  groupBy?: ReportGroupBy;
};

const reportFiltersSchema = z
  .object({
    startDate: z.union([z.date(), z.string()]).optional(),
    endDate: z.union([z.date(), z.string()]).optional(),
    type: z.nativeEnum(TransactionType).optional(),
    categoryId: z.string().min(1).optional(),
    qualityRating: z.nativeEnum(QualityRating).optional(),
    moneySourceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    savingGoalId: z.string().min(1).optional(),
    groupBy: z.enum(["day", "week", "month"]).optional()
  })
  .strict();

function parseReportFilters(filters: ReportFilters) {
  const result = reportFiltersSchema.safeParse(filters);

  if (!result.success) {
    throw new Error("Invalid report filters.");
  }

  return result.data;
}

function buildReportTransactionWhere(
  userId: string,
  filters: ReportFilters
): Prisma.TransactionWhereInput {
  const parsed = parseReportFilters(filters);

  return {
    userId,
    ...(parsed.type ? { type: parsed.type } : {}),
    ...(parsed.categoryId ? { categoryId: parsed.categoryId } : {}),
    ...(parsed.qualityRating
      ? { qualityRating: parsed.qualityRating }
      : {}),
    ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
    ...(parsed.moneySourceId
      ? {
          OR: [
            { fromMoneySourceId: parsed.moneySourceId },
            { toMoneySourceId: parsed.moneySourceId },
            { adjustedMoneySourceId: parsed.moneySourceId }
          ]
        }
      : {}),
    ...(parsed.savingGoalId
      ? {
          goalContributions: {
            some: { savingGoalId: parsed.savingGoalId }
          }
        }
      : {}),
    ...(parsed.startDate || parsed.endDate
      ? {
          transactionDate: transactionDateRange(
            parsed.startDate,
            parsed.endDate
          )
        }
      : {})
  };
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
  filters: ReportFilters
) {
  return prisma.transaction.findMany({
    where: buildReportTransactionWhere(userId, filters),
    orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }]
  });
}

export async function loadReportFilterOptions() {
  const scopedUserId = await getSessionUserId();
  const [categories, moneySources, projects, savingGoals] = await Promise.all([
    prisma.category.findMany({
      where: { userId: scopedUserId },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }),
    prisma.moneySource.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true }
    }),
    prisma.financialProject.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true }
    }),
    prisma.savingGoal.findMany({
      where: { userId: scopedUserId },
      orderBy: [{ status: "asc" }, { deadline: "asc" }, { name: "asc" }],
      select: { id: true, name: true }
    })
  ]);

  return { categories, moneySources, projects, savingGoals };
}

export async function loadIncomeVsExpenseOverTime(
  filters: ReportFilters = {}
) {
  const scopedUserId = await getSessionUserId();
  const parsed = parseReportFilters(filters);
  const transactions = await getTransactionsInRange(scopedUserId, parsed);

  return getIncomeVsExpenseOverTime(transactions, parsed.groupBy ?? "month");
}

export async function loadExpenseByCategory(
  filters: ReportFilters = {}
) {
  const scopedUserId = await getSessionUserId();
  const [transactions, categories] = await Promise.all([
    getTransactionsInRange(scopedUserId, filters),
    prisma.category.findMany({
      where: { userId: scopedUserId },
      orderBy: { name: "asc" }
    })
  ]);

  return getExpenseByCategory(transactions, categories);
}

export async function loadSpendingQualityBreakdown(
  filters: ReportFilters = {}
) {
  const scopedUserId = await getSessionUserId();
  const transactions = await getTransactionsInRange(scopedUserId, filters);

  return getSpendingQualityBreakdown(transactions);
}

export async function loadGoalProgressReport(filters: ReportFilters = {}) {
  const scopedUserId = await getSessionUserId();
  const parsed = parseReportFilters(filters);
  const goals = await prisma.savingGoal.findMany({
    where: {
      userId: scopedUserId,
      ...(parsed.savingGoalId ? { id: parsed.savingGoalId } : {})
    },
    orderBy: [{ status: "asc" }, { deadline: "asc" }, { name: "asc" }],
    include: {
      goalContributions: {
        where: {
          userId: scopedUserId,
          ...(parsed.moneySourceId
            ? { fromMoneySourceId: parsed.moneySourceId }
            : {}),
          ...(parsed.startDate || parsed.endDate
            ? {
                contributionDate: transactionDateRange(
                  parsed.startDate,
                  parsed.endDate
                )
              }
            : {})
        }
      }
    }
  });

  return goals.map((goal) => ({
    goal,
    progress: calculateGoalProgress(goal.goalContributions, goal.targetAmount)
  }));
}

export async function loadProjectProfitLoss(filters: ReportFilters = {}) {
  const scopedUserId = await getSessionUserId();
  const parsed = parseReportFilters(filters);
  const [projects, transactions] = await Promise.all([
    prisma.financialProject.findMany({
      where: {
        userId: scopedUserId,
        ...(parsed.projectId ? { id: parsed.projectId } : {})
      },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    }),
    getTransactionsInRange(scopedUserId, parsed)
  ]);

  return getProjectProfitLoss(transactions, projects);
}

export async function loadSpendingBySource(
  filters: ReportFilters = {}
) {
  const scopedUserId = await getSessionUserId();
  const parsed = parseReportFilters(filters);
  const [transactions, sources] = await Promise.all([
    getTransactionsInRange(scopedUserId, parsed),
    prisma.moneySource.findMany({
      where: {
        userId: scopedUserId,
        ...(parsed.moneySourceId ? { id: parsed.moneySourceId } : {})
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    })
  ]);

  return getSpendingBySource(transactions, sources);
}

export async function loadCreditCardDebtReport(filters: ReportFilters = {}) {
  const scopedUserId = await getSessionUserId();
  const parsed = parseReportFilters(filters);
  const [creditCards, transactions] = await Promise.all([
    prisma.moneySource.findMany({
      where: {
        userId: scopedUserId,
        type: MoneySourceType.CREDIT_CARD,
        ...(parsed.moneySourceId ? { id: parsed.moneySourceId } : {})
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    }),
    getTransactionsInRange(scopedUserId, parsed)
  ]);

  return creditCards.map((source) => ({
    source,
    state: calculateCreditCardState(source, transactions)
  }));
}

export async function loadFeeWaiverReport(filters: ReportFilters = {}) {
  const scopedUserId = await getSessionUserId();
  const parsed = parseReportFilters(filters);
  const [creditCards, transactions] = await Promise.all([
    prisma.moneySource.findMany({
      where: {
        userId: scopedUserId,
        type: MoneySourceType.CREDIT_CARD,
        annualFeeWaiverEnabled: true,
        ...(parsed.moneySourceId ? { id: parsed.moneySourceId } : {})
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    }),
    getTransactionsInRange(scopedUserId, parsed)
  ]);

  return creditCards.map((source) => ({
    source,
    state: calculateFeeWaiverState(source, transactions)
  }));
}

function buildRenewalWhere(
  userId: string,
  filters: ReportFilters,
  fallbackRange?: { startDate: Date; endDate: Date }
): Prisma.RecurringPaymentWhereInput {
  const parsed = parseReportFilters(filters);
  const startDate = parsed.startDate ?? fallbackRange?.startDate;
  const endDate = parsed.endDate ?? fallbackRange?.endDate;

  return {
    userId,
    status: RenewalStatus.ACTIVE,
    ...(parsed.type ? { transactionType: parsed.type } : {}),
    ...(parsed.categoryId ? { categoryId: parsed.categoryId } : {}),
    ...(parsed.qualityRating
      ? { qualityRating: parsed.qualityRating }
      : {}),
    ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
    ...(parsed.moneySourceId
      ? {
          OR: [
            { fromMoneySourceId: parsed.moneySourceId },
            { toMoneySourceId: parsed.moneySourceId }
          ]
        }
      : {}),
    ...(startDate || endDate
      ? { nextDueDate: transactionDateRange(startDate, endDate) }
      : {})
  };
}

export async function loadUpcomingRenewalsTotal(
  filters: ReportFilters = {}
) {
  const scopedUserId = await getSessionUserId();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addMonths(today, 12);
  const renewals = await prisma.recurringPayment.findMany({
    where: buildRenewalWhere(scopedUserId, filters, {
      startDate: today,
      endDate
    }),
    orderBy: [{ nextDueDate: "asc" }, { title: "asc" }]
  });

  return {
    ...getUpcomingRenewalsTotal(renewals),
    renewals
  };
}

export async function loadRecurringExpensePerMonth(
  filters: ReportFilters = {}
) {
  const scopedUserId = await getSessionUserId();
  const renewals = await prisma.recurringPayment.findMany({
    where: buildRenewalWhere(scopedUserId, filters),
    orderBy: [{ nextDueDate: "asc" }, { title: "asc" }]
  });

  return getRecurringExpensePerMonth(renewals);
}
