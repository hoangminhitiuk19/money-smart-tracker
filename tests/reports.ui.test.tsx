import { QualityRating, TransactionType } from "@prisma/client";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportsPage from "@/app/(protected)/reports/page";

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
  requireAuth: vi.fn()
}));

vi.mock("@/lib/auth", () => ({ requireAuth: reportPageMocks.requireAuth }));
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

async function renderReportsMarkup() {
  const shell = (await ReportsPage({
    searchParams: Promise.resolve(searchParams)
  })) as ReactElement<{ children: ReportsContentElement }>;
  const contentElement = shell.props.children;
  const content = await contentElement.type(contentElement.props);
  return renderToStaticMarkup(content);
}

beforeEach(() => {
  vi.clearAllMocks();
  reportPageMocks.requireAuth.mockResolvedValue({ id: "report-user" });
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
});
