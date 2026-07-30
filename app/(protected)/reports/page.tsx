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
import {
  decimal,
  moneyText,
  type DecimalInput
} from "@/lib/money";
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

function groupRenewalsByMonth(
  renewals: Array<{ amount: DecimalInput; nextDueDate: Date | string }>
) {
  const totals = new Map<string, ReturnType<typeof decimal>>();

  for (const renewal of renewals) {
    const dueDate = new Date(renewal.nextDueDate);
    const period = `${dueDate.getFullYear()}-${String(
      dueDate.getMonth() + 1
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
