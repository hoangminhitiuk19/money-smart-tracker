import {
  loadCreditCardDebtReport,
  loadExpenseByCategory,
  loadFeeWaiverReport,
  loadGoalProgressReport,
  loadIncomeVsExpenseOverTime,
  loadProjectProfitLoss,
  loadRecurringExpensePerMonth,
  loadReportFilterOptions,
  loadSpendingBySource,
  loadSpendingQualityBreakdown,
  loadUpcomingRenewalsTotal,
  type ReportFilters
} from "@/lib/actions/reports";
import { getUserSettings } from "@/lib/actions/settings";
import { QualityRating, TransactionType } from "@prisma/client";
import { Suspense } from "react";
import {
  decimal,
  moneyText,
  type DecimalInput
} from "@/lib/money";
import { ReportsClient } from "@/components/reports/ReportsClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { parseTransactionDateRange } from "@/lib/date-range";
import type { UserFormatSettings } from "@/lib/user-format";
import ReportsLoading from "./loading";

type SearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function inputDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function validDateParam(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return parseTransactionDateRange(value).ok ? value : undefined;
}

function enumParam<T extends string>(
  value: string | undefined,
  values: readonly T[]
) {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

function idParam(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function getReportFilters(searchParams: SearchParams) {
  const today = new Date();
  const fallbackStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const fallbackEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const startDate =
    validDateParam(getParam(searchParams, "startDate")) ??
    inputDateValue(fallbackStart);
  const endDate =
    validDateParam(getParam(searchParams, "endDate")) ??
    inputDateValue(fallbackEnd);

  return {
    startDate,
    endDate,
    type: enumParam(
      getParam(searchParams, "type"),
      Object.values(TransactionType)
    ),
    categoryId: idParam(getParam(searchParams, "categoryId")),
    qualityRating: enumParam(
      getParam(searchParams, "qualityRating"),
      Object.values(QualityRating)
    ),
    moneySourceId: idParam(getParam(searchParams, "moneySourceId")),
    projectId: idParam(getParam(searchParams, "projectId")),
    savingGoalId: idParam(getParam(searchParams, "savingGoalId")),
    groupBy:
      enumParam(getParam(searchParams, "groupBy"), [
        "day",
        "week",
        "month"
      ] as const) ?? "month"
  };
}

function groupRenewalsByMonth(
  renewals: Array<{ amount: DecimalInput; nextDueDate: Date | string }>
) {
  const totals = new Map<string, ReturnType<typeof decimal>>();

  for (const renewal of renewals) {
    const dueDate = new Date(renewal.nextDueDate);
    const period = `${dueDate.getUTCFullYear()}-${String(
      dueDate.getUTCMonth() + 1
    ).padStart(2, "0")}`;
    totals.set(
      period,
      (totals.get(period) ?? decimal(0)).plus(decimal(renewal.amount))
    );
  }

  return Array.from(totals.entries())
    .map(([period, total]) => ({ period, total: moneyText(total) }))
    .sort((left, right) => left.period.localeCompare(right.period));
}

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function ReportsPage({
  searchParams
}: PageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<ReportsLoading />}>
      <ReportsPageContent searchParams={resolvedSearchParams} />
    </Suspense>
  );
}

async function ReportsPageContent({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const { settings } = await getUserSettings();
  const filters = getReportFilters(searchParams) satisfies ReportFilters;
  const [
    filterOptions,
    incomeVsExpense,
    expenseByCategory,
    qualityBreakdown,
    goalProgress,
    projectProfitLoss,
    spendingBySource,
    creditCardDebt,
    feeWaivers,
    upcomingRenewals,
    recurringExpensePerMonth
  ] = await Promise.all([
    loadReportFilterOptions(),
    loadIncomeVsExpenseOverTime(filters),
    loadExpenseByCategory(filters),
    loadSpendingQualityBreakdown(filters),
    loadGoalProgressReport(filters),
    loadProjectProfitLoss(filters),
    loadSpendingBySource(filters),
    loadCreditCardDebtReport(filters),
    loadFeeWaiverReport(filters),
    loadUpcomingRenewalsTotal(filters),
    loadRecurringExpensePerMonth(filters)
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <PageHeader title="Reports" />
        <p className="text-sm text-slate-600">
          Explore trends, quality, goals, cards, renewals, and recurring costs.
        </p>
      </div>

      <ReportsClient
        creditCardDebt={creditCardDebt.map(({ source, state }) => ({
          id: source.id,
          name: source.name,
          currency: source.currency,
          outstandingDebt: moneyText(state.outstandingDebt),
          availableCredit: moneyText(state.availableCredit),
          cardCredit: moneyText(state.cardCredit)
        }))}
        expenseByCategory={expenseByCategory.map((item) => ({
          ...item,
          total: moneyText(item.total)
        }))}
        feeWaivers={feeWaivers.map(({ source, state }) => ({
          id: source.id,
          name: source.name,
          currency: source.currency,
          eligibleSpending: moneyText(state.eligibleSpending),
          progress: state.progress.toString(),
          remaining: moneyText(state.remaining)
        }))}
        filterOptions={filterOptions}
        filters={filters}
        formatSettings={{
          defaultCurrency: settings.defaultCurrency,
          dateFormat: settings.dateFormat as UserFormatSettings["dateFormat"],
          numberFormat:
            settings.numberFormat as UserFormatSettings["numberFormat"]
        }}
        goalProgress={goalProgress.map(({ goal, progress }) => ({
          id: goal.id,
          name: goal.name,
          currency: goal.currency,
          targetAmount: moneyText(goal.targetAmount),
          netContributed: moneyText(progress.netContributed),
          progressPercent: progress.progressPercent.toString(),
          remaining: moneyText(progress.remaining)
        }))}
        incomeVsExpense={incomeVsExpense.map((item) => ({
          period: item.period,
          income: moneyText(item.income),
          expense: moneyText(item.expense)
        }))}
        projectProfitLoss={projectProfitLoss.map((item) => ({
          projectName: item.projectName,
          totalIncome: moneyText(item.totalIncome),
          totalExpense: moneyText(item.totalExpense),
          profit: moneyText(item.profit),
          roi: item.roi?.toString() ?? null
        }))}
        qualityBreakdown={qualityBreakdown.map((item) => ({
          ...item,
          total: moneyText(item.total)
        }))}
        recurringExpensePerMonth={recurringExpensePerMonth.map((item) => ({
          period: item.period,
          total: moneyText(item.total)
        }))}
        spendingBySource={spendingBySource.map((item) => ({
          ...item,
          total: moneyText(item.total)
        }))}
        upcomingRenewalsByMonth={groupRenewalsByMonth(
          upcomingRenewals.renewals
        )}
      />
    </div>
  );
}
