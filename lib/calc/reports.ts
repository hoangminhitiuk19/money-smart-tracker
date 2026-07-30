import {
  Prisma,
  RenewalFrequency,
  QualityRating,
  TransactionType
} from "@prisma/client";
import { decimal, percent, type DecimalInput } from "@/lib/money";

type ReportAmount = DecimalInput;

export type ReportTransaction = {
  id?: string;
  type: TransactionType;
  amount: ReportAmount;
  transactionDate: Date | string;
  categoryId?: string | null;
  qualityRating?: QualityRating | null;
  fromMoneySourceId?: string | null;
  projectId?: string | null;
  relatedTransactionId?: string | null;
};

export type ReportCategory = {
  id: string;
  name: string;
};

export type ReportMoneySource = {
  id: string;
  name: string;
};

export type ReportProject = {
  id: string;
  name: string;
};

export type ReportRenewal = {
  id: string;
  title: string;
  amount: ReportAmount;
  transactionType: TransactionType;
  frequency: RenewalFrequency;
  intervalCount: number;
  nextDueDate: Date | string;
};

export type ReportGroupBy = "day" | "week" | "month";

function dateKey(date: Date | string) {
  return new Date(date).toISOString().slice(0, 10);
}

function getPeriod(date: Date | string, groupBy: ReportGroupBy) {
  const value = new Date(date);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");

  if (groupBy === "month") {
    return `${year}-${month}`;
  }

  if (groupBy === "week") {
    const startOfWeek = new Date(
      Date.UTC(year, value.getUTCMonth(), value.getUTCDate())
    );
    const day = startOfWeek.getUTCDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - daysSinceMonday);
    return dateKey(startOfWeek);
  }

  return dateKey(value);
}

function expenseById(transactions: ReportTransaction[]) {
  return new Map(
    transactions
      .filter(
        (transaction) =>
          transaction.id && transaction.type === TransactionType.EXPENSE
      )
      .map((transaction) => [transaction.id as string, transaction])
  );
}

function linkedRefunds(transactions: ReportTransaction[]) {
  const expenses = expenseById(transactions);

  return transactions.flatMap((transaction) => {
    if (
      transaction.type !== TransactionType.REFUND ||
      !transaction.relatedTransactionId
    ) {
      return [];
    }

    const expense = expenses.get(transaction.relatedTransactionId);

    if (!expense) {
      return [];
    }

    return [
      {
        amount: decimal(transaction.amount),
        expense
      }
    ];
  });
}

export function getIncomeVsExpenseOverTime(
  transactions: ReportTransaction[],
  groupBy: ReportGroupBy
) {
  const groups = new Map<
    string,
    { income: Prisma.Decimal; expense: Prisma.Decimal }
  >();

  function ensureGroup(period: string) {
    const group = groups.get(period) ?? {
      income: decimal(0),
      expense: decimal(0)
    };
    groups.set(period, group);
    return group;
  }

  for (const transaction of transactions) {
    if (
      transaction.type !== TransactionType.INCOME &&
      transaction.type !== TransactionType.EXPENSE
    ) {
      continue;
    }

    const group = ensureGroup(getPeriod(transaction.transactionDate, groupBy));

    if (transaction.type === TransactionType.INCOME) {
      group.income = group.income.plus(decimal(transaction.amount));
    } else {
      group.expense = group.expense.plus(decimal(transaction.amount));
    }
  }

  for (const refund of linkedRefunds(transactions)) {
    const group = ensureGroup(
      getPeriod(refund.expense.transactionDate, groupBy)
    );
    group.expense = group.expense.minus(refund.amount);
  }

  return Array.from(groups.entries())
    .map(([period, totals]) => ({
      period,
      income: totals.income,
      expense: totals.expense
    }))
    .sort((left, right) => left.period.localeCompare(right.period));
}

export function getExpenseByCategory(
  transactions: ReportTransaction[],
  categories: ReportCategory[]
) {
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name])
  );
  const totals = new Map<string, Prisma.Decimal>();

  for (const transaction of transactions) {
    if (
      transaction.type !== TransactionType.EXPENSE ||
      !transaction.categoryId
    ) {
      continue;
    }

    totals.set(
      transaction.categoryId,
      (totals.get(transaction.categoryId) ?? decimal(0)).plus(
        decimal(transaction.amount)
      )
    );
  }

  for (const refund of linkedRefunds(transactions)) {
    const categoryId = refund.expense.categoryId;

    if (!categoryId) {
      continue;
    }

    totals.set(
      categoryId,
      (totals.get(categoryId) ?? decimal(0)).minus(refund.amount)
    );
  }

  return Array.from(totals.entries())
    .map(([categoryId, total]) => ({
      categoryName: categoryNames.get(categoryId) ?? "Uncategorized",
      total
    }))
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName));
}

export function getSpendingQualityBreakdown(
  transactions: ReportTransaction[]
) {
  const totals = new Map<
    QualityRating,
    { count: number; total: Prisma.Decimal }
  >();

  for (const transaction of transactions) {
    if (
      transaction.type !== TransactionType.EXPENSE ||
      !transaction.qualityRating
    ) {
      continue;
    }

    const group = totals.get(transaction.qualityRating) ?? {
      count: 0,
      total: decimal(0)
    };
    group.count += 1;
    group.total = group.total.plus(decimal(transaction.amount));
    totals.set(transaction.qualityRating, group);
  }

  for (const refund of linkedRefunds(transactions)) {
    const rating = refund.expense.qualityRating;

    if (!rating) {
      continue;
    }

    const group = totals.get(rating) ?? { count: 0, total: decimal(0) };
    group.total = group.total.minus(refund.amount);
    totals.set(rating, group);
  }

  return Array.from(totals.entries())
    .map(([rating, totals]) => ({
      rating,
      count: totals.count,
      total: totals.total
    }))
    .sort((left, right) => left.rating.localeCompare(right.rating));
}

export function getSpendingBySource(
  transactions: ReportTransaction[],
  sources: ReportMoneySource[]
) {
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  const totals = new Map<string, Prisma.Decimal>();

  for (const transaction of transactions) {
    if (
      transaction.type !== TransactionType.EXPENSE ||
      !transaction.fromMoneySourceId
    ) {
      continue;
    }

    totals.set(
      transaction.fromMoneySourceId,
      (totals.get(transaction.fromMoneySourceId) ?? decimal(0)).plus(
        decimal(transaction.amount)
      )
    );
  }

  for (const refund of linkedRefunds(transactions)) {
    const sourceId = refund.expense.fromMoneySourceId;

    if (!sourceId) {
      continue;
    }

    totals.set(
      sourceId,
      (totals.get(sourceId) ?? decimal(0)).minus(refund.amount)
    );
  }

  return Array.from(totals.entries())
    .map(([sourceId, total]) => ({
      sourceName: sourceNames.get(sourceId) ?? "Unknown source",
      total
    }))
    .sort((left, right) => left.sourceName.localeCompare(right.sourceName));
}

export function getProjectProfitLoss(
  transactions: ReportTransaction[],
  projects: ReportProject[]
) {
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name])
  );
  const totals = new Map<
    string,
    { totalIncome: Prisma.Decimal; totalExpense: Prisma.Decimal }
  >();

  function ensureGroup(projectId: string) {
    const group = totals.get(projectId) ?? {
      totalIncome: decimal(0),
      totalExpense: decimal(0)
    };
    totals.set(projectId, group);
    return group;
  }

  for (const transaction of transactions) {
    if (
      !transaction.projectId ||
      (transaction.type !== TransactionType.INCOME &&
        transaction.type !== TransactionType.EXPENSE)
    ) {
      continue;
    }

    const group = ensureGroup(transaction.projectId);

    if (transaction.type === TransactionType.INCOME) {
      group.totalIncome = group.totalIncome.plus(decimal(transaction.amount));
    } else {
      group.totalExpense = group.totalExpense.plus(
        decimal(transaction.amount)
      );
    }
  }

  for (const refund of linkedRefunds(transactions)) {
    const projectId = refund.expense.projectId;

    if (!projectId) {
      continue;
    }

    const group = ensureGroup(projectId);
    group.totalExpense = group.totalExpense.minus(refund.amount);
  }

  return Array.from(totals.entries())
    .map(([projectId, totals]) => {
      const profit = totals.totalIncome.minus(totals.totalExpense);

      return {
        projectName: projectNames.get(projectId) ?? "Unknown project",
        totalIncome: totals.totalIncome,
        totalExpense: totals.totalExpense,
        profit,
        roi:
          totals.totalExpense.gt(0)
            ? percent(profit, totals.totalExpense)
            : null
      };
    })
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
}

export function getUpcomingRenewalsTotal(renewals: ReportRenewal[]) {
  return {
    total: renewals.reduce(
      (total, renewal) => total.plus(decimal(renewal.amount)),
      decimal(0)
    ),
    count: renewals.length
  };
}

export function getRecurringExpensePerMonth(renewals: ReportRenewal[]) {
  const totals = new Map<string, Prisma.Decimal>();

  for (const renewal of renewals) {
    if (renewal.transactionType !== TransactionType.EXPENSE) {
      continue;
    }

    const period = getPeriod(renewal.nextDueDate, "month");
    totals.set(
      period,
      (totals.get(period) ?? decimal(0)).plus(decimal(renewal.amount))
    );
  }

  return Array.from(totals.entries())
    .map(([period, total]) => ({ period, total }))
    .sort((left, right) => left.period.localeCompare(right.period));
}
