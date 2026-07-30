"use client";

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
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ProgressBar } from "@/components/ui/ProgressBar";

type MoneyPoint = {
  period: string;
  income?: number;
  expense?: number;
  total?: number;
};

type NamedTotal = {
  categoryName?: string;
  sourceName?: string;
  rating?: string;
  count?: number;
  total: number;
};

type GoalReport = {
  id: string;
  name: string;
  currency: string;
  targetAmount: number;
  netContributed: number;
  progressPercent: number;
  remaining: number;
};

type ProjectReport = {
  projectName: string;
  totalIncome: number;
  totalExpense: number;
  profit: number;
  roi: number | null;
};

type CreditCardDebtReport = {
  id: string;
  name: string;
  currency: string;
  outstandingDebt: number;
  availableCredit: number;
  cardCredit: number;
};

type FeeWaiverReport = {
  id: string;
  name: string;
  currency: string;
  eligibleSpending: number;
  progress: number;
  remaining: number;
};

type ReportsClientProps = {
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

type CurrencyTooltipProps = Partial<TooltipContentProps>;

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

function formatMoney(amount: number, currency = "VND") {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 0,
    style: "currency"
  }).format(amount);
}

function formatPercent(amount: number) {
  return `${amount.toFixed(1)}%`;
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
          <a href="#report-range">
            <Button variant="outline">Change Date Range</Button>
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

function CurrencyTooltip({ active, payload, label }: CurrencyTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <p className="mb-1 font-medium text-slate-950">{label}</p>
      {payload.map((item, index) => (
        <p className="text-slate-600" key={String(item.dataKey ?? item.name ?? index)}>
          {item.name}: {formatMoney(Number(item.value))}
        </p>
      ))}
    </div>
  );
}

function TotalTable({
  label,
  rows
}: {
  label: string;
  rows: Array<{ name: string; total: number; count?: number }>;
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
                {formatMoney(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsClient({
  creditCardDebt,
  expenseByCategory,
  feeWaivers,
  goalProgress,
  incomeVsExpense,
  projectProfitLoss,
  qualityBreakdown,
  recurringExpensePerMonth,
  spendingBySource,
  upcomingRenewalsByMonth
}: ReportsClientProps) {
  const [activeTab, setActiveTab] = useState<TabId>("income-expense");
  const categoryChartData = useMemo(
    () =>
      expenseByCategory.map((item) => ({
        name: item.categoryName ?? "Uncategorized",
        total: item.total
      })),
    [expenseByCategory]
  );
  const qualityChartData = useMemo(
    () =>
      qualityBreakdown.map((item) => ({
        count: item.count,
        name: item.rating ?? "Unrated",
        total: item.total
      })),
    [qualityBreakdown]
  );
  const sourceChartData = useMemo(
    () =>
      spendingBySource.map((item) => ({
        name: item.sourceName ?? "Unknown source",
        total: item.total
      })),
    [spendingBySource]
  );

  return (
    <section className="space-y-5">
      <nav className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200/70 bg-card-bg p-2 shadow-sm">
        {tabs.map((tab) => (
          <button
            className={[
              "min-h-11 shrink-0 rounded-md px-3 py-2 text-sm font-medium transition md:min-h-0",
              activeTab === tab.id
                ? "bg-primary text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            ].join(" ")}
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
              <LineChart data={incomeVsExpense}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis tickFormatter={(value) => formatMoney(Number(value))} />
                <Tooltip content={<CurrencyTooltip />} />
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
                <Tooltip content={<CurrencyTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <TotalTable label="Category" rows={categoryChartData} />
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
                <Tooltip content={<CurrencyTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <TotalTable label="Rating" rows={qualityChartData} />
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
              <BarChart data={projectProfitLoss}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="projectName" />
                <YAxis tickFormatter={(value) => formatMoney(Number(value))} />
                <Tooltip content={<CurrencyTooltip />} />
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
                <YAxis tickFormatter={(value) => formatMoney(Number(value))} />
                <Tooltip content={<CurrencyTooltip />} />
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
              <BarChart data={upcomingRenewalsByMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis tickFormatter={(value) => formatMoney(Number(value))} />
                <Tooltip content={<CurrencyTooltip />} />
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
              <BarChart data={recurringExpensePerMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" />
                <YAxis tickFormatter={(value) => formatMoney(Number(value))} />
                <Tooltip content={<CurrencyTooltip />} />
                <Bar dataKey="total" fill="#9333ea" name="Total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportPanel>
      ) : null}
    </section>
  );
}
