import { QualityRating, TransactionType } from "@prisma/client";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportsPage from "@/app/(protected)/reports/page";
import { ReportsClient } from "@/components/reports/ReportsClient";

const reportPageMocks = vi.hoisted(() => ({
  loadCreditCardDebtReport: vi.fn(),
  loadExpenseByCategory: vi.fn(),
  loadFeeWaiverReport: vi.fn(),
  loadGoalProgressReport: vi.fn(),
  loadIncomeVsExpenseOverTime: vi.fn(),
  loadProjectProfitLoss: vi.fn(),
  loadRecurringExpensePerMonth: vi.fn(),
  loadReportFilterOptions: vi.fn(),
  loadSpendingBySource: vi.fn(),
  loadSpendingQualityBreakdown: vi.fn(),
  loadUpcomingRenewalsTotal: vi.fn(),
  getUserSettings: vi.fn(),
  requireAuth: vi.fn()
}));

vi.mock("@/lib/auth", () => ({ requireAuth: reportPageMocks.requireAuth }));
vi.mock("@/lib/actions/settings", () => ({
  getUserSettings: reportPageMocks.getUserSettings
}));
vi.mock("@/lib/actions/reports", () => ({
  loadCreditCardDebtReport: reportPageMocks.loadCreditCardDebtReport,
  loadExpenseByCategory: reportPageMocks.loadExpenseByCategory,
  loadFeeWaiverReport: reportPageMocks.loadFeeWaiverReport,
  loadGoalProgressReport: reportPageMocks.loadGoalProgressReport,
  loadIncomeVsExpenseOverTime: reportPageMocks.loadIncomeVsExpenseOverTime,
  loadProjectProfitLoss: reportPageMocks.loadProjectProfitLoss,
  loadRecurringExpensePerMonth: reportPageMocks.loadRecurringExpensePerMonth,
  loadReportFilterOptions: reportPageMocks.loadReportFilterOptions,
  loadSpendingBySource: reportPageMocks.loadSpendingBySource,
  loadSpendingQualityBreakdown:
    reportPageMocks.loadSpendingQualityBreakdown,
  loadUpcomingRenewalsTotal: reportPageMocks.loadUpcomingRenewalsTotal
}));

const searchParams = {
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  type: TransactionType.EXPENSE,
  categoryId: "category-a",
  qualityRating: QualityRating.A,
  moneySourceId: "source-a",
  projectId: "project-a",
  savingGoalId: "goal-a",
  groupBy: "week"
};

const expectedFilters = {
  ...searchParams,
  type: TransactionType.EXPENSE,
  qualityRating: QualityRating.A,
  groupBy: "week"
};

type ReportsContentElement = ReactElement<{
  searchParams: Record<string, string | string[] | undefined>;
}> & {
  type: (props: {
    searchParams: Record<string, string | string[] | undefined>;
  }) => Promise<ReactElement>;
};

async function renderReportsMarkup(
  selectedSearchParams: Record<string, string | string[] | undefined> =
    searchParams
) {
  return renderToStaticMarkup(await getReportsContent(selectedSearchParams));
}

async function getReportsContent(
  selectedSearchParams: Record<string, string | string[] | undefined> =
    searchParams
) {
  const shell = (await ReportsPage({
    searchParams: Promise.resolve(selectedSearchParams)
  })) as ReactElement<{ children: ReportsContentElement }>;
  const contentElement = shell.props.children;
  return contentElement.type(contentElement.props);
}

function findReportsClient(
  element: ReactElement
): ReactElement<{ formatSettings?: unknown }> | null {
  if (element.type === ReportsClient) {
    return element as ReactElement<{ formatSettings?: unknown }>;
  }

  const children = (element.props as { children?: unknown }).children;
  const candidates = Array.isArray(children) ? children : [children];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "type" in candidate &&
      "props" in candidate
    ) {
      const match = findReportsClient(candidate as ReactElement);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  reportPageMocks.requireAuth.mockResolvedValue({ id: "report-user" });
  reportPageMocks.getUserSettings.mockResolvedValue({
    settings: {
      defaultCurrency: "USD",
      dateFormat: "YYYY-MM-DD",
      numberFormat: "1.000.000",
      defaultDashboardPeriod: "Year"
    },
    user: { id: "report-user" }
  });
  reportPageMocks.loadCreditCardDebtReport.mockResolvedValue([]);
  reportPageMocks.loadExpenseByCategory.mockResolvedValue([]);
  reportPageMocks.loadFeeWaiverReport.mockResolvedValue([]);
  reportPageMocks.loadGoalProgressReport.mockResolvedValue([]);
  reportPageMocks.loadIncomeVsExpenseOverTime.mockResolvedValue([]);
  reportPageMocks.loadProjectProfitLoss.mockResolvedValue([]);
  reportPageMocks.loadRecurringExpensePerMonth.mockResolvedValue([]);
  reportPageMocks.loadReportFilterOptions.mockResolvedValue({
    categories: [{ id: "category-a", name: "Travel" }],
    moneySources: [{ id: "source-a", name: "Daily card" }],
    projects: [{ id: "project-a", name: "Home project" }],
    savingGoals: [{ id: "goal-a", name: "Emergency fund" }]
  });
  reportPageMocks.loadSpendingBySource.mockResolvedValue([]);
  reportPageMocks.loadSpendingQualityBreakdown.mockResolvedValue([]);
  reportPageMocks.loadUpcomingRenewalsTotal.mockResolvedValue({
    count: 0,
    renewals: [],
    total: "0.00"
  });
});

describe("reports filter URL state", () => {
  it("passes the complete selected contract to all ten report loaders", async () => {
    await renderReportsMarkup();

    const loaders = [
      reportPageMocks.loadIncomeVsExpenseOverTime,
      reportPageMocks.loadExpenseByCategory,
      reportPageMocks.loadSpendingQualityBreakdown,
      reportPageMocks.loadGoalProgressReport,
      reportPageMocks.loadProjectProfitLoss,
      reportPageMocks.loadSpendingBySource,
      reportPageMocks.loadCreditCardDebtReport,
      reportPageMocks.loadFeeWaiverReport,
      reportPageMocks.loadUpcomingRenewalsTotal,
      reportPageMocks.loadRecurringExpensePerMonth
    ];

    for (const loader of loaders) {
      expect(loader).toHaveBeenCalledWith(expectedFilters);
    }
  });

  it("renders persistent controls and visible active-filter context", async () => {
    const markup = await renderReportsMarkup();
    const controlNames = [
      "startDate",
      "endDate",
      "type",
      "categoryId",
      "qualityRating",
      "moneySourceId",
      "projectId",
      "savingGoalId",
      "groupBy"
    ];

    for (const name of controlNames) {
      expect(markup.match(new RegExp(`name="${name}"`, "g")) ?? []).toHaveLength(
        1
      );
    }
    expect(markup).toContain('value="2026-07-01"');
    expect(markup).toContain('value="2026-07-31"');
    expect(markup).toContain('value="EXPENSE" selected=""');
    expect(markup).toContain('value="category-a" selected=""');
    expect(markup).toContain('value="A" selected=""');
    expect(markup).toContain('value="source-a" selected=""');
    expect(markup).toContain('value="project-a" selected=""');
    expect(markup).toContain('value="goal-a" selected=""');
    expect(markup).toContain('value="week" selected=""');
    expect(markup).toContain('aria-label="Active report filters"');
    expect(markup).toContain("9 active filters");
    expect(markup).toContain("Travel");
    expect(markup).toContain("Daily card");
    expect(markup).toContain("Home project");
    expect(markup).toContain("Emergency fund");
    expect(markup).toContain("Apply filters");
    expect(markup).toContain('href="/reports"');
    expect(markup).toContain("Reset filters");
    expect(markup).toContain('href="#report-filters"');
  });

  it("labels ADJUSTMENT wherever the report filter surfaces that type", async () => {
    const markup = await renderReportsMarkup({
      ...searchParams,
      type: TransactionType.ADJUSTMENT
    });

    expect(markup).toContain('value="ADJUSTMENT" selected=""');
    expect(markup).toContain(
      '<span class="font-semibold text-slate-950">Type</span> ADJUSTMENT'
    );
  });

  it("loads persisted display settings once and passes them to the report client", async () => {
    const content = await getReportsContent();
    const reportsClient = findReportsClient(content);

    expect(reportsClient?.props.formatSettings).toEqual({
      defaultCurrency: "USD",
      dateFormat: "YYYY-MM-DD",
      numberFormat: "1.000.000"
    });
    expect(reportPageMocks.getUserSettings).toHaveBeenCalledTimes(1);
  });

  it("formats visible date filters while preserving ISO date input values", async () => {
    reportPageMocks.getUserSettings.mockResolvedValueOnce({
      settings: {
        defaultCurrency: "USD",
        dateFormat: "DD/MM/YYYY",
        numberFormat: "1.000.000",
        defaultDashboardPeriod: "Year"
      },
      user: { id: "report-user" }
    });

    const markup = await renderReportsMarkup();

    expect(markup).toContain('type="date" name="startDate" value="2026-07-01"');
    expect(markup).toContain('type="date" name="endDate" value="2026-07-31"');
    expect(markup).toContain("From</span> 01/07/2026");
    expect(markup).toContain("Through</span> 31/07/2026");
  });
});
