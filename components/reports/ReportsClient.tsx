"use client";

import { QualityRating, TransactionType } from "@prisma/client";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis
} from "recharts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import {
  presentationNumber,
  type DecimalInput
} from "@/lib/money";
import {
  formatUserDate,
  formatUserMoney,
  type UserFormatSettings
} from "@/lib/user-format";

type MoneyPoint = {
  period: string;
  income?: string;
  expense?: string;
  total?: string;
};

type NamedTotal = {
  categoryName?: string;
  sourceName?: string;
  rating?: string;
  count?: number;
  total: string;
};

type GoalReport = {
  id: string;
  name: string;
  currency: string;
  targetAmount: string;
  netContributed: string;
  progressPercent: string;
  remaining: string;
};

type ProjectReport = {
  projectName: string;
  totalIncome: string;
  totalExpense: string;
  profit: string;
  roi: string | null;
};

type CreditCardDebtReport = {
  id: string;
  name: string;
  currency: string;
  outstandingDebt: string;
  availableCredit: string;
  cardCredit: string;
};

type FeeWaiverReport = {
  id: string;
  name: string;
  currency: string;
  eligibleSpending: string;
  progress: string;
  remaining: string;
};

type FilterOption = {
  id: string;
  name: string;
};

type ReportFilterState = {
  startDate: string;
  endDate: string;
  type?: TransactionType;
  categoryId?: string;
  qualityRating?: QualityRating;
  moneySourceId?: string;
  projectId?: string;
  savingGoalId?: string;
  groupBy: "day" | "week" | "month";
};

type ReportFilterOptions = {
  categories: FilterOption[];
  moneySources: FilterOption[];
  projects: FilterOption[];
  savingGoals: FilterOption[];
};

type ReportsClientProps = {
  formatSettings: UserFormatSettings;
  filters: ReportFilterState;
  filterOptions: ReportFilterOptions;
  incomeVsExpense: MoneyPoint[];
  expenseByCategory: NamedTotal[];
  qualityBreakdown: NamedTotal[];
  goalProgress: GoalReport[];
  projectProfitLoss: ProjectReport[];
  spendingBySource: NamedTotal[];
  creditCardDebt: CreditCardDebtReport[];
  feeWaivers: FeeWaiverReport[];
  upcomingRenewalsByMonth: MoneyPoint[];
  recurringExpensePerMonth: MoneyPoint[];
};

type CurrencyTooltipProps = Partial<TooltipContentProps> & {
  formatSettings: UserFormatSettings;
};

const chartColors = [
  "#0f766e",
  "#2563eb",
  "#f97316",
  "#9333ea",
  "#dc2626",
  "#16a34a",
  "#64748b"
];

const tabs = [
  { id: "income-expense", label: "Income vs Expense" },
  { id: "category", label: "Categories" },
  { id: "quality", label: "Quality" },
  { id: "goals", label: "Goals" },
  { id: "projects", label: "Projects" },
  { id: "sources", label: "Accounts" },
  { id: "debt", label: "Card Debt" },
  { id: "waivers", label: "Fee Waivers" },
  { id: "renewals", label: "Renewals" },
  { id: "recurring", label: "Recurring" }
] as const;

type TabId = (typeof tabs)[number]["id"];

const transactionTypes = Object.values(TransactionType);
const qualityRatings = Object.values(QualityRating);

function formatPercent(amount: DecimalInput) {
  return `${presentationNumber(amount).toFixed(1)}%`;
}

function reportIsEmpty(data: unknown[]) {
  return data.length === 0;
}

function ReportPanel({
  children,
  empty,
  loading = false,
  title
}: {
  children: React.ReactNode;
  empty: boolean;
  loading?: boolean;
  title: string;
}) {
  if (loading) {
    return (
      <Card title={title}>
        <LoadingSkeleton height={36} rows={6} />
      </Card>
    );
  }

  if (empty) {
    return (
      <EmptyState
        cta={
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:min-h-0"
            href="#report-filters"
          >
            Change filters
          </a>
        }
        title={
          <>
            No data for this period &mdash; Try a different date range
          </>
        }
        subtitle="Adjust the report dates or add more transactions to populate this view."
      />
    );
  }

  return <Card title={title}>{children}</Card>;
}

function CurrencyTooltip({
  active,
  formatSettings,
  payload,
  label
}: CurrencyTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <p className="mb-1 font-medium text-slate-950">{label}</p>
      {payload.map((item, index) => (
        <p className="text-slate-600" key={String(item.dataKey ?? item.name ?? index)}>
          {item.name}:{" "}
          {formatUserMoney(
            String(
              item.payload?.[`${String(item.dataKey)}Text`] ?? item.value ?? 0
            ),
            formatSettings.defaultCurrency,
            formatSettings
          )}
        </p>
      ))}
    </div>
  );
}

function TotalTable({
  formatSettings,
  label,
  rows
}: {
  formatSettings: UserFormatSettings;
  label: string;
  rows: Array<{ name: string; total: number; totalText: string; count?: number }>;
}) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="min-w-[32rem] divide-y divide-slate-100 text-sm md:min-w-full">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">{label}</th>
            <th className="px-4 py-3">Count</th>
            <th className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="px-4 py-3 font-medium text-slate-950">
                {row.name}
              </td>
              <td className="px-4 py-3 text-slate-600">{row.count ?? "-"}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">
                {formatUserMoney(
                  row.totalText,
                  formatSettings.defaultCurrency,
                  formatSettings
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function selectedOptionName(options: FilterOption[], selectedId?: string) {
  if (!selectedId) {
    return undefined;
  }

  return options.find(({ id }) => id === selectedId)?.name ?? selectedId;
}

function ReportFilterPanel({
  filters,
  formatSettings,
  options
}: {
  filters: ReportFilterState;
  formatSettings: UserFormatSettings;
  options: ReportFilterOptions;
}) {
  const activeFilters = [
    filters.startDate
      ? {
          label: "From",
          value: formatUserDate(filters.startDate, formatSettings)
        }
      : null,
    filters.endDate
      ? {
          label: "Through",
          value: formatUserDate(filters.endDate, formatSettings)
        }
      : null,
    filters.type ? { label: "Type", value: filters.type } : null,
    filters.categoryId
      ? {
          label: "Category",
          value: selectedOptionName(options.categories, filters.categoryId)
        }
      : null,
    filters.qualityRating
      ? { label: "Quality", value: filters.qualityRating }
      : null,
    filters.moneySourceId
      ? {
          label: "Source",
          value: selectedOptionName(
            options.moneySources,
            filters.moneySourceId
          )
        }
      : null,
    filters.projectId
      ? {
          label: "Project",
          value: selectedOptionName(options.projects, filters.projectId)
        }
      : null,
    filters.savingGoalId
      ? {
          label: "Goal",
          value: selectedOptionName(options.savingGoals, filters.savingGoalId)
        }
      : null,
    filters.groupBy
      ? {
          label: "Group",
          value:
            filters.groupBy.charAt(0).toUpperCase() + filters.groupBy.slice(1)
        }
      : null
  ].filter(
    (filter): filter is { label: string; value: string } =>
      filter !== null && filter.value !== undefined
  );

  return (
    <section
      className="scroll-mt-6 overflow-hidden rounded-xl border border-slate-200/70 bg-card-bg shadow-sm"
      id="report-filters"
    >
      <div className="border-b border-slate-200/70 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-950">Report filters</h2>
            <p className="mt-0.5 text-xs text-slate-500" id="report-filter-help">
              Use the dimensions that matter to this audit. Every selection
              stays in the URL.
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            {activeFilters.length} active filters
          </span>
        </div>
      </div>

      <form
        aria-describedby="report-filter-help"
        className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3 xl:grid-cols-5"
        method="get"
      >
        <label>
          <span className="text-xs font-medium text-slate-700">Start date</span>
          <Input
            className="mt-1"
            defaultValue={filters.startDate}
            name="startDate"
            type="date"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">End date</span>
          <Input
            className="mt-1"
            defaultValue={filters.endDate}
            name="endDate"
            type="date"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">
            Transaction type
          </span>
          <Select className="mt-1" defaultValue={filters.type ?? ""} name="type">
            <option value="">All types</option>
            {transactionTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">Category</span>
          <Select
            className="mt-1"
            defaultValue={filters.categoryId ?? ""}
            name="categoryId"
          >
            <option value="">All categories</option>
            {options.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">Quality</span>
          <Select
            className="mt-1"
            defaultValue={filters.qualityRating ?? ""}
            name="qualityRating"
          >
            <option value="">All ratings</option>
            {qualityRatings.map((rating) => (
              <option key={rating} value={rating}>
                {rating}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">
            Account or wallet
          </span>
          <Select
            className="mt-1"
            defaultValue={filters.moneySourceId ?? ""}
            name="moneySourceId"
          >
            <option value="">All sources</option>
            {options.moneySources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">Project</span>
          <Select
            className="mt-1"
            defaultValue={filters.projectId ?? ""}
            name="projectId"
          >
            <option value="">All projects</option>
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">Saving goal</span>
          <Select
            className="mt-1"
            defaultValue={filters.savingGoalId ?? ""}
            name="savingGoalId"
          >
            <option value="">All goals</option>
            {options.savingGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="text-xs font-medium text-slate-700">Group by</span>
          <Select
            className="mt-1"
            defaultValue={filters.groupBy}
            name="groupBy"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </Select>
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-1">
          <Button className="flex-1" type="submit">
            Apply filters
          </Button>
          <a
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:min-h-0"
            href="/reports"
          >
            Reset filters
          </a>
        </div>
      </form>

      <div
        aria-label="Active report filters"
        className="border-t border-slate-200/70 bg-slate-50/80 px-4 py-3 sm:px-5"
      >
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Active filter context
        </p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {activeFilters.map((filter) => (
            <span
              className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm"
              key={filter.label}
            >
              <span className="font-semibold text-slate-950">
                {filter.label}
              </span>{" "}
              {filter.value}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ReportsClient({
  creditCardDebt,
  expenseByCategory,
  feeWaivers,
  filterOptions,
  filters,
  formatSettings,
  goalProgress,
  incomeVsExpense,
  projectProfitLoss,
  qualityBreakdown,
  recurringExpensePerMonth,
  spendingBySource,
  upcomingRenewalsByMonth
}: ReportsClientProps) {
  const formatMoney = (
    amount: DecimalInput,
    currency = formatSettings.defaultCurrency
  ) => formatUserMoney(amount, currency, formatSettings);
  const [activeTab, setActiveTab] = useState<TabId>("income-expense");
  const incomeExpenseChartData = useMemo(
    () =>
      incomeVsExpense.map((item) => ({
        period: item.period,
        income:
          item.income === undefined
            ? undefined
            : presentationNumber(item.income),
        incomeText: item.income,
        expense:
          item.expense === undefined
            ? undefined
            : presentationNumber(item.expense),
        expenseText: item.expense
      })),
    [incomeVsExpense]
  );
  const categoryChartData = useMemo(
    () =>
      expenseByCategory.map((item) => ({
        name: item.categoryName ?? "Uncategorized",
        total: presentationNumber(item.total),
        totalText: item.total
      })),
    [expenseByCategory]
  );
  const qualityChartData = useMemo(
    () =>
      qualityBreakdown.map((item) => ({
        count: item.count,
        name: item.rating ?? "Unrated",
        total: presentationNumber(item.total),
        totalText: item.total
      })),
    [qualityBreakdown]
  );
  const sourceChartData = useMemo(
    () =>
      spendingBySource.map((item) => ({
        name: item.sourceName ?? "Unknown source",
        total: presentationNumber(item.total),
        totalText: item.total
      })),
    [spendingBySource]
  );
  const projectChartData = useMemo(
    () =>
      projectProfitLoss.map((project) => ({
        ...project,
        totalIncome: presentationNumber(project.totalIncome),
        totalIncomeText: project.totalIncome,
        totalExpense: presentationNumber(project.totalExpense),
        totalExpenseText: project.totalExpense,
        profit: presentationNumber(project.profit),
        profitText: project.profit
      })),
    [projectProfitLoss]
  );
  const upcomingRenewalChartData = useMemo(
    () =>
      upcomingRenewalsByMonth.map((item) => ({
        period: item.period,
        total: presentationNumber(item.total ?? 0),
        totalText: item.total
      })),
    [upcomingRenewalsByMonth]
  );
  const recurringExpenseChartData = useMemo(
    () =>
      recurringExpensePerMonth.map((item) => ({
        period: item.period,
        total: presentationNumber(item.total ?? 0),
        totalText: item.total
      })),
    [recurringExpensePerMonth]
  );

  return (
    <section className="space-y-5">
      <ReportFilterPanel
        filters={filters}
        formatSettings={formatSettings}
        options={filterOptions}
      />

      <nav
        aria-label="Report views"
        className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200/70 bg-card-bg p-2 shadow-sm"
      >
        {tabs.map((tab) => (
          <button
            className={[
              "min-h-11 shrink-0 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:min-h-0",
              activeTab === tab.id
                ? "bg-primary text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            ].join(" ")}
            aria-pressed={activeTab === tab.id}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "income-expense" ? (
        <ReportPanel
          empty={reportIsEmpty(incomeVsExpense)}
          title="Income vs Expense"
        >
          <div className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={incomeExpenseChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis
                  tickFormatter={(value) =>
                    formatMoney(presentationNumber(value))
                  }
                />
                <Tooltip
                  content={<CurrencyTooltip formatSettings={formatSettings} />}
                />
                <Legend />
                <Line
                  dataKey="income"
                  name="Income"
                  stroke="#16a34a"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  dataKey="expense"
                  name="Expense"
                  stroke="#dc2626"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ReportPanel>
      ) : null}

      {activeTab === "category" ? (
        <ReportPanel
          empty={reportIsEmpty(categoryChartData)}
          title="Expense by Category"
        >
          <div className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <PieChart>
                <Pie
                  data={categoryChartData}
                  dataKey="total"
                  nameKey="name"
                  outerRadius={110}
                >
                  {categoryChartData.map((entry, index) => (
                    <Cell
                      fill={chartColors[index % chartColors.length]}
                      key={entry.name}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={<CurrencyTooltip formatSettings={formatSettings} />}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <TotalTable
            formatSettings={formatSettings}
            label="Category"
            rows={categoryChartData}
          />
        </ReportPanel>
      ) : null}

      {activeTab === "quality" ? (
        <ReportPanel
          empty={reportIsEmpty(qualityChartData)}
          title="Spending Quality Breakdown"
        >
          <div className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <PieChart>
                <Pie
                  data={qualityChartData}
                  dataKey="total"
                  nameKey="name"
                  outerRadius={110}
                >
                  {qualityChartData.map((entry, index) => (
                    <Cell
                      fill={chartColors[index % chartColors.length]}
                      key={entry.name}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={<CurrencyTooltip formatSettings={formatSettings} />}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <TotalTable
            formatSettings={formatSettings}
            label="Rating"
            rows={qualityChartData}
          />
        </ReportPanel>
      ) : null}

      {activeTab === "goals" ? (
        <ReportPanel
          empty={reportIsEmpty(goalProgress)}
          title="Saving Goal Progress"
        >
          <div className="space-y-5">
            {goalProgress.map((goal) => (
              <div key={goal.id}>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-950">
                    {goal.name}
                  </span>
                  <span className="text-slate-600">
                    {formatPercent(goal.progressPercent)}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar color="#059669" percent={goal.progressPercent} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatMoney(goal.netContributed, goal.currency)} of{" "}
                  {formatMoney(goal.targetAmount, goal.currency)}. Remaining{" "}
                  {formatMoney(goal.remaining, goal.currency)}.
                </p>
              </div>
            ))}
          </div>
        </ReportPanel>
      ) : null}

      {activeTab === "projects" ? (
        <ReportPanel
          empty={reportIsEmpty(projectProfitLoss)}
          title="Project Profit/Loss"
        >
          <div className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={projectChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="projectName" />
                <YAxis
                  tickFormatter={(value) =>
                    formatMoney(presentationNumber(value))
                  }
                />
                <Tooltip
                  content={<CurrencyTooltip formatSettings={formatSettings} />}
                />
                <Legend />
                <Bar dataKey="totalIncome" fill="#16a34a" name="Income" />
                <Bar dataKey="totalExpense" fill="#dc2626" name="Expense" />
                <Bar dataKey="profit" fill="#2563eb" name="Profit" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-[44rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3 text-right">Income</th>
                  <th className="px-4 py-3 text-right">Expense</th>
                  <th className="px-4 py-3 text-right">Profit</th>
                  <th className="px-4 py-3 text-right">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectProfitLoss.map((project) => (
                  <tr key={project.projectName}>
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {project.projectName}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(project.totalIncome)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(project.totalExpense)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatMoney(project.profit)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {project.roi === null ? "-" : formatPercent(project.roi)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReportPanel>
      ) : null}

      {activeTab === "sources" ? (
        <ReportPanel
          empty={reportIsEmpty(sourceChartData)}
          title="Spending by Account/Wallet"
        >
          <div className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={sourceChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis
                  tickFormatter={(value) =>
                    formatMoney(presentationNumber(value))
                  }
                />
                <Tooltip
                  content={<CurrencyTooltip formatSettings={formatSettings} />}
                />
                <Bar dataKey="total" fill="#0f766e" name="Total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportPanel>
      ) : null}

      {activeTab === "debt" ? (
        <ReportPanel empty={reportIsEmpty(creditCardDebt)} title="Credit Card Debt">
          <div className="overflow-x-auto">
            <table className="min-w-[36rem] divide-y divide-slate-100 text-sm md:min-w-full">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Card</th>
                  <th className="px-4 py-3 text-right">Debt</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3 text-right">Card Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {creditCardDebt.map((card) => (
                  <tr key={card.id}>
                    <td className="px-4 py-3 font-medium text-slate-950">
                      {card.name}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-expense">
                      {formatMoney(card.outstandingDebt, card.currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(card.availableCredit, card.currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(card.cardCredit, card.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReportPanel>
      ) : null}

      {activeTab === "waivers" ? (
        <ReportPanel
          empty={reportIsEmpty(feeWaivers)}
          title="Annual Fee Waiver Progress"
        >
          <div className="space-y-5">
            {feeWaivers.map((card) => (
              <div key={card.id}>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-950">
                    {card.name}
                  </span>
                  <span className="text-slate-600">
                    {formatPercent(card.progress)}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar color="#4f46e5" percent={card.progress} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Eligible {formatMoney(card.eligibleSpending, card.currency)}.
                  Remaining {formatMoney(card.remaining, card.currency)}.
                </p>
              </div>
            ))}
          </div>
        </ReportPanel>
      ) : null}

      {activeTab === "renewals" ? (
        <ReportPanel
          empty={reportIsEmpty(upcomingRenewalsByMonth)}
          title="Upcoming Renewals Total"
        >
          <div className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={upcomingRenewalChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis
                  tickFormatter={(value) =>
                    formatMoney(presentationNumber(value))
                  }
                />
                <Tooltip
                  content={<CurrencyTooltip formatSettings={formatSettings} />}
                />
                <Bar dataKey="total" fill="#f97316" name="Total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportPanel>
      ) : null}

      {activeTab === "recurring" ? (
        <ReportPanel
          empty={reportIsEmpty(recurringExpensePerMonth)}
          title="Recurring Expenses Per Month"
        >
          <div className="h-80">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={recurringExpenseChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis
                  tickFormatter={(value) =>
                    formatMoney(presentationNumber(value))
                  }
                />
                <Tooltip
                  content={<CurrencyTooltip formatSettings={formatSettings} />}
                />
                <Bar dataKey="total" fill="#9333ea" name="Total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportPanel>
      ) : null}
    </section>
  );
}
