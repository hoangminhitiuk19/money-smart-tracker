import {
  GoalStatus,
  MoneySourceType,
  ProjectStatus,
  RenewalFrequency,
  RenewalStatus,
  TransactionType
} from "@prisma/client";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountDetailPage from "@/app/(protected)/accounts/[id]/page";
import AccountsPage from "@/app/(protected)/accounts/page";
import GoalsPage from "@/app/(protected)/goals/page";
import ProjectsPage from "@/app/(protected)/projects/page";
import RenewalsPage from "@/app/(protected)/renewals/page";
import TransactionsPage from "@/app/(protected)/transactions/page";
import { decimal } from "@/lib/money";

const pageMocks = vi.hoisted(() => ({
  formAction: vi.fn(async () => undefined),
  getMoneySource: vi.fn(),
  getUpcomingRenewals: vi.fn(),
  getUserSettings: vi.fn(),
  listCategories: vi.fn(),
  listGoals: vi.fn(),
  listMoneySources: vi.fn(),
  listProjects: vi.fn(),
  listRenewals: vi.fn(),
  requireAuth: vi.fn(),
  searchTransactions: vi.fn(),
  transactionFindMany: vi.fn()
}));

vi.mock("@/lib/actions/settings", () => ({
  getUserSettings: pageMocks.getUserSettings
}));
vi.mock("@/lib/auth", () => ({ requireAuth: pageMocks.requireAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: pageMocks.transactionFindMany }
  }
}));
vi.mock("@/lib/actions/categories", () => ({
  listCategories: pageMocks.listCategories
}));
vi.mock("@/lib/actions/goals", () => ({
  createGoalFormAction: pageMocks.formAction,
  deleteGoalFormAction: pageMocks.formAction,
  listGoals: pageMocks.listGoals,
  updateGoalFormAction: pageMocks.formAction
}));
vi.mock("@/lib/actions/projects", () => ({
  createProjectFormAction: pageMocks.formAction,
  deleteProjectFormAction: pageMocks.formAction,
  listProjects: pageMocks.listProjects,
  updateProjectFormAction: pageMocks.formAction
}));
vi.mock("@/lib/actions/money-sources", () => ({
  createMoneySource: vi.fn(async () => ({ ok: true })),
  deleteMoneySourceFormAction: pageMocks.formAction,
  getMoneySource: pageMocks.getMoneySource,
  listMoneySources: pageMocks.listMoneySources,
  toggleMoneySourceActiveFormAction: pageMocks.formAction,
  updateMoneySource: vi.fn(async () => ({ ok: true }))
}));
vi.mock("@/lib/actions/renewals", () => ({
  cancelRenewalFormAction: pageMocks.formAction,
  createRenewalFormAction: pageMocks.formAction,
  deleteRenewal: vi.fn(async () => ({ ok: true })),
  getUpcomingRenewals: pageMocks.getUpcomingRenewals,
  listRenewals: pageMocks.listRenewals,
  markRenewalAsPaidFormAction: pageMocks.formAction,
  pauseRenewalFormAction: pageMocks.formAction,
  resumeRenewalFormAction: pageMocks.formAction,
  skipRenewalCycleFormAction: pageMocks.formAction,
  updateRenewalFormAction: pageMocks.formAction
}));
vi.mock("@/lib/actions/transactions", () => ({
  searchTransactions: pageMocks.searchTransactions
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("Not found");
  }),
  usePathname: vi.fn(() => "/transactions"),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams())
}));

type AsyncContentElement = ReactElement<Record<string, unknown>> & {
  type: (props: Record<string, unknown>) => Promise<ReactElement>;
};

async function renderPageShell(shellValue: unknown) {
  const shell = (await shellValue) as ReactElement<{
    children: AsyncContentElement;
  }>;
  const contentElement = shell.props.children;
  const content = await contentElement.type(contentElement.props);
  return renderToStaticMarkup(content);
}

function bankSource() {
  return {
    id: "bank-1",
    userId: "display-user",
    name: "Main bank",
    type: MoneySourceType.BANK_ACCOUNT,
    providerName: null,
    displayIdentifier: null,
    currency: "VND",
    openingBalance: decimal("1000000"),
    description: null,
    isActive: true,
    cardLastFourDigits: null,
    cardNetwork: null,
    openedDate: null,
    creditLimit: null,
    initialOutstandingDebt: decimal(0),
    initialCardCredit: decimal(0),
    billingCycleDay: null,
    paymentDueDay: null,
    hasAnnualFee: false,
    annualFeeAmount: null,
    annualFeeCurrency: "VND",
    annualFeeChargeDate: null,
    annualFeeFrequency: null,
    firstYearFeeWaived: false,
    freeYearsCount: null,
    feeWaivedUntilDate: null,
    annualFeeWaiverEnabled: false,
    annualFeeWaiverSpendTarget: null,
    annualFeeWaiverPeriod: null,
    waiverPeriodStartDate: null,
    waiverPeriodEndDate: null,
    annualFeeWaiverNote: null
  };
}

function transaction() {
  return {
    id: "transaction-1",
    userId: "display-user",
    title: "Exact amount",
    description: null,
    type: TransactionType.EXPENSE,
    amount: decimal("1000000"),
    currency: "VND",
    transactionDate: new Date("2026-07-30T00:00:00.000Z"),
    createdAt: new Date("2026-07-30T00:00:01.000Z"),
    category: null,
    qualityRating: null,
    fromMoneySource: null,
    toMoneySource: null,
    adjustedMoneySource: null,
    fromMoneySourceId: "bank-1",
    toMoneySourceId: null,
    adjustedMoneySourceId: null,
    adjustmentDirection: null,
    adjustmentTarget: null,
    relatedTransactionId: null,
    countTowardFeeWaiver: true,
    projectId: null
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pageMocks.getUserSettings.mockResolvedValue({
    settings: {
      defaultCurrency: "USD",
      dateFormat: "YYYY-MM-DD",
      numberFormat: "1.000.000",
      defaultDashboardPeriod: "Year"
    },
    user: { id: "display-user" }
  });
  pageMocks.requireAuth.mockResolvedValue({ id: "display-user" });
  pageMocks.listCategories.mockResolvedValue([]);
  pageMocks.listGoals.mockResolvedValue([]);
  pageMocks.listMoneySources.mockResolvedValue([]);
  pageMocks.listProjects.mockResolvedValue([]);
  pageMocks.listRenewals.mockResolvedValue([]);
  pageMocks.getUpcomingRenewals.mockResolvedValue([]);
  pageMocks.transactionFindMany.mockResolvedValue([]);
  pageMocks.searchTransactions.mockResolvedValue({
    transactions: [],
    total: 0,
    page: 1,
    pageSize: 20
  });
});

describe("persisted display settings page boundaries", () => {
  it("formats account values and applies the default currency to the add form", async () => {
    pageMocks.listMoneySources.mockResolvedValueOnce([bankSource()]);

    const markup = await renderPageShell(AccountsPage());

    expect(markup).toContain("1.000.000");
    expect(markup).toContain('name="currency" value="USD"');
    expect(pageMocks.getUserSettings).toHaveBeenCalledTimes(1);
  });

  it("formats account-detail transaction money and dates", async () => {
    pageMocks.getMoneySource.mockResolvedValueOnce(bankSource());
    pageMocks.transactionFindMany.mockResolvedValueOnce([transaction()]);

    const markup = await renderPageShell(
      AccountDetailPage({ params: Promise.resolve({ id: "bank-1" }) })
    );

    expect(markup).toContain("1.000.000");
    expect(markup).toContain("2026-07-30");
    expect(pageMocks.getUserSettings).toHaveBeenCalledTimes(1);
  });

  it("formats goal money and deadlines and defaults new goals to the user currency", async () => {
    pageMocks.listGoals.mockResolvedValueOnce([
      {
        id: "goal-1",
        userId: "display-user",
        name: "Large goal",
        targetAmount: decimal("1000000"),
        currency: "VND",
        deadline: new Date("2026-07-30T00:00:00.000Z"),
        description: null,
        status: GoalStatus.ACTIVE,
        goalContributions: []
      }
    ]);

    const markup = await renderPageShell(GoalsPage());

    expect(markup).toContain("1.000.000");
    expect(markup).toContain("Deadline 2026-07-30");
    expect(markup).toContain('name="currency" value="USD"');
    expect(pageMocks.getUserSettings).toHaveBeenCalledTimes(1);
  });

  it("formats currency-less project totals with the default currency", async () => {
    pageMocks.listProjects.mockResolvedValueOnce([
      {
        id: "project-1",
        userId: "display-user",
        name: "Large project",
        description: null,
        status: ProjectStatus.ACTIVE
      }
    ]);
    pageMocks.transactionFindMany.mockResolvedValueOnce([
      { ...transaction(), projectId: "project-1" }
    ]);

    const markup = await renderPageShell(ProjectsPage());

    expect(markup).toContain("1.000.000");
    expect(markup).toContain("$");
    expect(pageMocks.getUserSettings).toHaveBeenCalledTimes(1);
  });

  it("formats renewal value currencies and due dates", async () => {
    pageMocks.listRenewals.mockResolvedValueOnce([
      {
        id: "renewal-1",
        userId: "display-user",
        title: "Large renewal",
        description: null,
        amount: decimal("1000000"),
        currency: "VND",
        nextDueDate: new Date("2026-07-30T00:00:00.000Z"),
        frequency: RenewalFrequency.MONTHLY,
        intervalCount: 1,
        reminderDaysBefore: 7,
        status: RenewalStatus.ACTIVE,
        transactionType: TransactionType.EXPENSE,
        autoCreateTransaction: false,
        fromMoneySourceId: null,
        toMoneySourceId: null,
        categoryId: null,
        projectId: null,
        qualityRating: null,
        fromMoneySource: null,
        toMoneySource: null
      }
    ]);

    const markup = await renderPageShell(
      RenewalsPage({ searchParams: Promise.resolve({ status: "ACTIVE" }) })
    );

    expect(markup).toContain("1.000.000");
    expect(markup).toContain("Due 2026-07-30");
    expect(markup).toContain('name="currency" value="USD"');
    expect(pageMocks.getUserSettings).toHaveBeenCalledTimes(1);
  });

  it("formats transaction value currencies and transaction dates", async () => {
    pageMocks.searchTransactions.mockResolvedValueOnce({
      transactions: [transaction()],
      total: 1,
      page: 1,
      pageSize: 20
    });

    const markup = await renderPageShell(
      TransactionsPage({ searchParams: Promise.resolve({}) })
    );

    expect(markup).toContain("1.000.000");
    expect(markup).toContain("2026-07-30");
    expect(pageMocks.getUserSettings).toHaveBeenCalledTimes(1);
  });
});
