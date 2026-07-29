import {
  loadCreditCardDebtReport,
  loadExpenseByCategory,
  loadFeeWaiverReport,
  loadGoalProgressReport,
  loadIncomeVsExpenseOverTime,
  loadProjectProfitLoss,
  loadRecurringExpensePerMonth,
  loadSpendingBySource,
  loadSpendingQualityBreakdown,
  loadUpcomingRenewalsTotal
} from "@/lib/actions/reports";
import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import { ReportsClient } from "@/components/reports/ReportsClient";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import ReportsLoading from "./loading";

type SearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: SearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function inputDateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateInput(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateRange(searchParams: SearchParams) {
  const today = new Date();
  const fallbackStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const fallbackEnd = endOfDay(
    new Date(today.getFullYear(), today.getMonth() + 1, 0)
  );
  const startDate = parseDateInput(getParam(searchParams, "startDate"));
  const endDate = parseDateInput(getParam(searchParams, "endDate"));

  return {
    startDate: startDate ? startOfDay(startDate) : fallbackStart,
    endDate: endDate ? endOfDay(endDate) : fallbackEnd
  };
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    return value.toNumber();
  }

  return Number(value?.toString?.() ?? 0);
}

function groupRenewalsByMonth(
  renewals: Array<{ amount: unknown; nextDueDate: Date | string }>
) {
  const totals = new Map<string, number>();

  for (const renewal of renewals) {
    const dueDate = new Date(renewal.nextDueDate);
    const period = `${dueDate.getFullYear()}-${String(
      dueDate.getMonth() + 1
    ).padStart(2, "0")}`;
    totals.set(period, (totals.get(period) ?? 0) + toNumber(renewal.amount));
  }

  return Array.from(totals.entries())
    .map(([period, total]) => ({ period, total }))
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
  await requireAuth();
  const { startDate, endDate } = getDateRange(searchParams);
  const [
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
    loadIncomeVsExpenseOverTime(startDate, endDate, "month"),
    loadExpenseByCategory(startDate, endDate),
    loadSpendingQualityBreakdown(startDate, endDate),
    loadGoalProgressReport(),
    loadProjectProfitLoss(),
    loadSpendingBySource(startDate, endDate),
    loadCreditCardDebtReport(),
    loadFeeWaiverReport(),
    loadUpcomingRenewalsTotal(12),
    loadRecurringExpensePerMonth(startDate, endDate)
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <PageHeader title="Reports" />
        <p className="text-sm text-slate-600">
          Explore trends, quality, goals, cards, renewals, and recurring costs.
        </p>
      </div>

      <section className="scroll-mt-6 rounded-xl border border-slate-200/70 bg-card-bg p-4 shadow-sm" id="report-range">
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="get">
          <label>
            <span className="text-sm font-medium text-slate-700">Start</span>
            <Input
              className="mt-1"
              defaultValue={inputDateValue(startDate)}
              name="startDate"
              type="date"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">End</span>
            <Input
              className="mt-1"
              defaultValue={inputDateValue(endDate)}
              name="endDate"
              type="date"
            />
          </label>
          <div className="md:mt-6">
            <Button className="w-full md:w-auto" type="submit">
              Apply Range
            </Button>
          </div>
        </form>
      </section>

      <ReportsClient
        creditCardDebt={creditCardDebt.map(({ source, state }) => ({
          id: source.id,
          name: source.name,
          currency: source.currency,
          outstandingDebt: state.outstandingDebt,
          availableCredit: state.availableCredit,
          cardCredit: state.cardCredit
        }))}
        expenseByCategory={expenseByCategory}
        feeWaivers={feeWaivers.map(({ source, state }) => ({
          id: source.id,
          name: source.name,
          currency: source.currency,
          eligibleSpending: state.eligibleSpending,
          progress: state.progress,
          remaining: state.remaining
        }))}
        goalProgress={goalProgress.map(({ goal, progress }) => ({
          id: goal.id,
          name: goal.name,
          currency: goal.currency,
          targetAmount: toNumber(goal.targetAmount),
          netContributed: progress.netContributed,
          progressPercent: progress.progressPercent,
          remaining: progress.remaining
        }))}
        incomeVsExpense={incomeVsExpense}
        projectProfitLoss={projectProfitLoss}
        qualityBreakdown={qualityBreakdown}
        recurringExpensePerMonth={recurringExpensePerMonth}
        spendingBySource={spendingBySource}
        upcomingRenewalsByMonth={groupRenewalsByMonth(
          upcomingRenewals.renewals
        )}
      />
    </div>
  );
}
