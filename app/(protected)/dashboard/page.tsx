import { ProjectStatus } from "@prisma/client";
import Link from "next/link";
import { Suspense } from "react";
import { getDashboardData } from "@/lib/actions/dashboard";
import { getUserSettings } from "@/lib/actions/settings";
import {
  decimal,
  type DecimalInput
} from "@/lib/money";
import {
  formatUserDate,
  formatUserMoney,
  type UserFormatSettings
} from "@/lib/user-format";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionRow } from "@/components/ui/SectionRow";
import {
  ArrowRightIcon,
  CreditCardIcon,
  GoalIcon,
  ProjectIcon,
  RenewalIcon,
  TrendDownIcon,
  TrendUpIcon,
  WalletIcon
} from "@/components/ui/icons";
import DashboardLoading from "./loading";

type SearchParams = Record<string, string | string[] | undefined>;

type PeriodKey = "week" | "month" | "year" | "custom";

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
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function parseDateInput(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeekStart(today: Date) {
  const date = startOfDay(today);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function getPeriod(searchParams: SearchParams, defaultPeriod: string) {
  const today = new Date();
  const periodParam = getParam(searchParams, "period");
  const persistedPeriod =
    defaultPeriod === "Week"
      ? "week"
      : defaultPeriod === "Year"
        ? "year"
        : "month";
  const period: PeriodKey =
    periodParam === "week" ||
    periodParam === "month" ||
    periodParam === "year" ||
    periodParam === "custom"
      ? periodParam
      : persistedPeriod;

  if (period === "week") {
    const startDate = getWeekStart(today);
    const endDate = endOfDay(new Date(startDate));
    endDate.setDate(endDate.getDate() + 6);
    return { period, startDate, endDate };
  }

  if (period === "year") {
    return {
      period,
      startDate: new Date(today.getFullYear(), 0, 1),
      endDate: endOfDay(new Date(today.getFullYear(), 11, 31))
    };
  }

  if (period === "custom") {
    const customStart = parseDateInput(getParam(searchParams, "startDate"));
    const customEnd = parseDateInput(getParam(searchParams, "endDate"));
    const fallbackStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const fallbackEnd = endOfDay(
      new Date(today.getFullYear(), today.getMonth() + 1, 0)
    );

    return {
      period,
      startDate: customStart ? startOfDay(customStart) : fallbackStart,
      endDate: customEnd ? endOfDay(customEnd) : fallbackEnd
    };
  }

  return {
    period,
    startDate: new Date(today.getFullYear(), today.getMonth(), 1),
    endDate: endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0))
  };
}

function formatPercent(amount: DecimalInput) {
  return `${decimal(amount).toDecimalPlaces(1).toFixed(1)}%`;
}

function periodHref(period: PeriodKey) {
  return `/dashboard?period=${period}`;
}

function SectionListEmpty({ text }: { text: string }) {
  return <p className="text-sm text-slate-500">{text}</p>;
}

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function DashboardPage({
  searchParams
}: PageProps) {
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardPageContent searchParams={resolvedSearchParams} />
    </Suspense>
  );
}

async function DashboardPageContent({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const { settings } = await getUserSettings();
  const formatSettings: UserFormatSettings = {
    defaultCurrency: settings.defaultCurrency,
    dateFormat: settings.dateFormat as UserFormatSettings["dateFormat"],
    numberFormat: settings.numberFormat as UserFormatSettings["numberFormat"]
  };
  const { period, startDate, endDate } = getPeriod(
    searchParams,
    settings.defaultDashboardPeriod
  );
  const dashboard = await getDashboardData(startDate, endDate);
  const formatMoney = (amount: DecimalInput, currency = settings.defaultCurrency) =>
    formatUserMoney(amount, currency, formatSettings);
  const formatDate = (date: Date | string) =>
    formatUserDate(date, formatSettings);
  const activeProjects = dashboard.projects.filter(
    ({ project }) => project.status === ProjectStatus.ACTIVE
  );
  const topGoals = dashboard.goals.slice(0, 3);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <PageHeader title="Dashboard" />
        <p className="text-sm text-slate-600">
          {formatDate(inputDateValue(dashboard.period.startDate))} to{" "}
          {formatDate(inputDateValue(dashboard.period.endDate))}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200/70 bg-card-bg p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <nav className="inline-flex w-fit gap-1 rounded-lg bg-slate-100 p-1">
            {[
              ["week", "This Week"],
              ["month", "This Month"],
              ["year", "This Year"]
            ].map(([key, label]) => (
              <Link
                className={[
                  "min-h-11 rounded-md px-3 py-1.5 text-sm font-medium transition md:min-h-0",
                  period === key
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600 hover:text-slate-950"
                ].join(" ")}
                href={periodHref(key as PeriodKey)}
                key={key}
              >
                {label}
              </Link>
            ))}
          </nav>

          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" method="get">
            <input name="period" type="hidden" value="custom" />
            <label>
              <span className="text-xs font-medium text-slate-600">Start</span>
              <input
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 md:min-h-0"
                defaultValue={inputDateValue(startDate)}
                name="startDate"
                type="date"
              />
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">End</span>
              <input
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 md:min-h-0"
                defaultValue={inputDateValue(endDate)}
                name="endDate"
                type="date"
              />
            </label>
            <button
              className={[
                "mt-5 min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition md:min-h-0",
                period === "custom"
                  ? "border-primary bg-primary text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              ].join(" ")}
              type="submit"
            >
              Custom Range
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl bg-slate-900 p-6 shadow-sm xl:col-span-1">
          <p className="text-sm font-medium text-slate-400">
            Estimated net position
          </p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white">
            {formatMoney(dashboard.summary.estimatedNetPosition)}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Current tracked estimate &middot; Estimated from your records
            &mdash; not official bank data
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2">
          <StatCard
            accentColor="#16a34a"
            icon={<TrendUpIcon className="h-5 w-5" />}
            label="Total income · Selected period"
            value={formatMoney(dashboard.summary.totalIncome)}
          />
          <StatCard
            accentColor="#dc2626"
            icon={<TrendDownIcon className="h-5 w-5" />}
            label="Total expense · Selected period"
            value={formatMoney(dashboard.summary.totalExpense)}
          />
          <StatCard
            accentColor="#2563eb"
            icon={<WalletIcon className="h-5 w-5" />}
            label="Net savings · Selected period"
            value={formatMoney(dashboard.summary.netSavings)}
          />
          <StatCard
            accentColor="#7c3aed"
            icon={<TrendUpIcon className="h-5 w-5" />}
            label="Saving rate · Selected period"
            value={formatPercent(dashboard.summary.savingRate)}
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <StatCard
          accentColor="#059669"
          icon={<GoalIcon className="h-5 w-5" />}
          label="High-quality %"
          value={formatPercent(dashboard.summary.highQualityPercent)}
        />
        <StatCard
          accentColor="#f97316"
          icon={<TrendDownIcon className="h-5 w-5" />}
          label="Low-quality amount"
          value={formatMoney(dashboard.summary.lowQualityAmount)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card
          action={
            <Link
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-indigo-700"
              href="/goals"
            >
              View all <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          }
          title="Active Goals"
        >
          {topGoals.length === 0 ? (
            <SectionListEmpty text="No active goals yet." />
          ) : (
            <div className="space-y-5">
              {topGoals.map(({ goal, progress }) => (
                <div key={goal.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-950">
                      {goal.name}
                    </span>
                    <span className="text-slate-600">
                      {formatPercent(progress.progressPercent)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar color="#059669" percent={progress.progressPercent} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatMoney(progress.netContributed, goal.currency)} of{" "}
                    {formatMoney(goal.targetAmount, goal.currency)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          action={
            <Link
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-indigo-700"
              href="/projects"
            >
              View all <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          }
          title="Active Projects"
        >
          {activeProjects.length === 0 ? (
            <SectionListEmpty text="No active projects yet." />
          ) : (
            <div className="divide-y divide-slate-100">
              {activeProjects.map(({ project, summary }) => (
                <SectionRow
                  icon={<ProjectIcon className="h-4 w-4" />}
                  key={project.id}
                  subtitle={`Income ${formatMoney(summary.totalIncome)} / Expense ${formatMoney(summary.totalExpense)}`}
                  title={project.name}
                  trailing={
                    <span
                      className={
                        summary.profit.gte(0) ? "text-income" : "text-expense"
                      }
                    >
                      {formatMoney(summary.profit)}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Credit Card Debt">
          {dashboard.creditCards.length === 0 ? (
            <SectionListEmpty text="No credit cards tracked yet." />
          ) : (
            <div className="divide-y divide-slate-100">
              {dashboard.creditCards.map(({ source, state }) => (
                <SectionRow
                  icon={<CreditCardIcon className="h-4 w-4" />}
                  key={source.id}
                  subtitle={`Available ${formatMoney(state.availableCredit, source.currency)} · Current tracked estimate`}
                  title={source.name}
                  trailing={
                    <span className="text-expense">
                      {formatMoney(state.outstandingDebt, source.currency)}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Fee Waiver Progress">
          {dashboard.feeWaivers.length === 0 ? (
            <SectionListEmpty text="No waiver-enabled cards yet." />
          ) : (
            <div className="space-y-5">
              {dashboard.feeWaivers.map(({ source, state }) => (
                <div key={source.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-950">
                      {source.name}
                    </span>
                    <span className="text-slate-600">
                      {formatPercent(state.progress)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar color="#4f46e5" percent={state.progress} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Eligible{" "}
                    {formatMoney(state.eligibleSpending, source.currency)} /
                    Remaining {formatMoney(state.remaining, source.currency)}{" "}
                    &middot; Tracked estimate
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Upcoming Renewals">
          {dashboard.renewals.upcoming.length === 0 ? (
            <SectionListEmpty text="No renewals inside their reminder window." />
          ) : (
            <div className="divide-y divide-slate-100">
              {dashboard.renewals.upcoming.map((renewal) => (
                <SectionRow
                  icon={<RenewalIcon className="h-4 w-4" />}
                  key={renewal.id}
                  subtitle={`Due ${formatDate(renewal.nextDueDate)}`}
                  title={renewal.title}
                  trailing={formatMoney(renewal.amount, renewal.currency)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Upcoming Card Fees">
          {dashboard.cardFees.upcoming.length === 0 ? (
            <SectionListEmpty text="No card fees due in the next 30 days." />
          ) : (
            <div className="divide-y divide-slate-100">
              {dashboard.cardFees.upcoming.map((source) => (
                <SectionRow
                  icon={<CreditCardIcon className="h-4 w-4" />}
                  key={source.id}
                  subtitle={`Due ${
                    source.annualFeeChargeDate
                      ? formatDate(source.annualFeeChargeDate)
                      : "Unknown"
                  }`}
                  title={source.name}
                  trailing={formatMoney(
                    source.annualFeeAmount ?? 0,
                    source.annualFeeCurrency
                  )}
                />
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
