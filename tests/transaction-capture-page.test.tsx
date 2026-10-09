import {
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TransactionCapturePage from "@/app/(protected)/transactions/capture/page";
import TransactionsPage from "@/app/(protected)/transactions/page";

const pageMocks = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
  listCategories: vi.fn(),
  listMoneySources: vi.fn(),
  listProjects: vi.fn(),
  loadTransactionCapture: vi.fn(),
  listTransactions: vi.fn(),
  searchTransactions: vi.fn(),
  workspace: vi.fn()
}));

vi.mock("@/components/transaction-capture/CaptureWorkspace", () => ({
  CaptureWorkspace: pageMocks.workspace
}));
vi.mock("@/lib/actions/categories", () => ({
  listCategories: pageMocks.listCategories
}));
vi.mock("@/lib/actions/money-sources", () => ({
  listMoneySources: pageMocks.listMoneySources
}));
vi.mock("@/lib/actions/projects", () => ({
  listProjects: pageMocks.listProjects
}));
vi.mock("@/lib/actions/settings", () => ({
  getUserSettings: pageMocks.getUserSettings
}));
vi.mock("@/lib/actions/transaction-drafts", () => ({
  loadTransactionCapture: pageMocks.loadTransactionCapture
}));
vi.mock("@/lib/actions/transactions", () => ({
  listTransactions: pageMocks.listTransactions,
  searchTransactions: pageMocks.searchTransactions
}));
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/transactions"),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams())
}));

type AsyncContentElement = ReactElement<Record<string, unknown>> & {
  type: (props: Record<string, unknown>) => Promise<ReactElement>;
};

async function renderTransactionsPage(searchParams: Record<string, string> = {}) {
  const shell = (await TransactionsPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement<{
    children: AsyncContentElement;
  }>;
  const content = await shell.props.children.type(shell.props.children.props);

  return renderToStaticMarkup(content);
}

async function renderCapturePage(capture?: string) {
  return renderToStaticMarkup(
    await TransactionCapturePage({
      searchParams: Promise.resolve(capture ? { capture } : {})
    })
  );
}

const captureKey = "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36";

beforeEach(() => {
  vi.clearAllMocks();
  pageMocks.workspace.mockImplementation(() => (
    <div>
      Capture transactions
      Paste rows
    </div>
  ));
  pageMocks.getUserSettings.mockResolvedValue({
    settings: {
      defaultCurrency: "USD",
      dateFormat: "YYYY-MM-DD",
      numberFormat: "1.000.000"
    },
    user: { id: "foreign-settings-user" }
  });
  pageMocks.listCategories.mockResolvedValue([
    {
      id: "category-1",
      name: "Food",
      defaultQualityRating: QualityRating.A,
      userId: "foreign-category-user"
    }
  ]);
  pageMocks.listMoneySources.mockResolvedValue([
    {
      id: "source-1",
      name: "Credit card",
      type: MoneySourceType.CREDIT_CARD,
      userId: "foreign-source-user"
    }
  ]);
  pageMocks.listProjects.mockResolvedValue([
    { id: "project-1", name: "Holiday", userId: "foreign-project-user" }
  ]);
  pageMocks.listTransactions.mockResolvedValue({
    transactions: [
      {
        id: "expense-1",
        title: "Coffee",
        amount: { toString: () => "45000.25" },
        transactionDate: new Date("2026-08-05T00:00:00.000Z"),
        userId: "foreign-expense-user"
      }
    ],
    pagination: { page: 1, pageSize: 100, totalCount: 1, totalPages: 1 }
  });
  pageMocks.loadTransactionCapture.mockResolvedValue({
    kind: "active",
    drafts: [],
    importedCount: 0
  });
  pageMocks.searchTransactions.mockResolvedValue({
    transactions: [],
    total: 0,
    page: 1,
    pageSize: 20
  });
});

describe("transaction capture page", () => {
  it("renders the capture workspace with only serialized, owned option values", async () => {
    const markup = await renderCapturePage("f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36");

    expect(markup).toContain("Capture transactions");
    expect(markup).toContain("Paste rows");
    expect(pageMocks.workspace).toHaveBeenCalledWith(
      expect.objectContaining({
        initialCaptureKey: "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36",
        initialDrafts: [],
        options: {
          categories: [
            {
              id: "category-1",
              name: "Food",
              defaultQualityRating: QualityRating.A
            }
          ],
          moneySources: [
            {
              id: "source-1",
              name: "Credit card",
              type: MoneySourceType.CREDIT_CARD
            }
          ],
          projects: [{ id: "project-1", name: "Holiday" }],
          expenses: [
            {
              id: "expense-1",
              name: "Coffee",
              title: "Coffee",
              amount: "45000.25",
              transactionDate: "2026-08-05"
            }
          ]
        },
        settings: {
          defaultCurrency: "USD",
          dateFormat: "YYYY-MM-DD",
          numberFormat: "1.000.000"
        }
      }),
      undefined
    );
    expect(markup).not.toContain("foreign-");
    expect(pageMocks.loadTransactionCapture).toHaveBeenCalledWith(
      "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36"
    );
    expect(pageMocks.listTransactions).toHaveBeenCalledWith({
      pageSize: 100,
      type: TransactionType.EXPENSE
    });
  });

  it("starts a new session when no capture is requested", async () => {
    await renderCapturePage();

    expect(pageMocks.workspace).toHaveBeenCalledWith(
      expect.objectContaining({ initialCaptureKey: null, initialDrafts: [] }),
      undefined
    );
    expect(pageMocks.loadTransactionCapture).not.toHaveBeenCalled();
  });

  it("shows the generic unavailable state for a malformed capture value", async () => {
    const markup = await renderCapturePage("not-a-capture-key");

    expect(markup).toContain("Capture unavailable");
    expect(markup).toContain('href="/transactions/capture"');
    expect(markup).not.toContain("not-a-capture-key");
    expect(pageMocks.workspace).not.toHaveBeenCalled();
    expect(pageMocks.loadTransactionCapture).not.toHaveBeenCalled();
  });

  it("renders the same unavailable state for a missing or foreign capture", async () => {
    pageMocks.loadTransactionCapture.mockResolvedValue({ kind: "unavailable" });

    const markup = await renderCapturePage(captureKey);

    expect(markup).toContain("Capture unavailable");
    expect(markup).toContain("Start another capture");
    expect(markup).not.toContain(captureKey);
    expect(pageMocks.workspace).not.toHaveBeenCalled();
  });

  it("links a single imported capture to its owned transaction", async () => {
    pageMocks.loadTransactionCapture.mockResolvedValue({
      kind: "imported",
      importedCount: 1,
      transactionIds: ["tx-1"]
    });

    const markup = await renderCapturePage(captureKey);

    expect(markup).toContain("Transaction imported");
    expect(markup).toContain("removed after import to protect your privacy");
    expect(markup).toMatch(/href="\/transactions\/tx-1\/edit"[^>]*>View transaction</);
    expect(markup).toContain("Start another capture");
    expect(markup).not.toContain(captureKey);
    expect(pageMocks.workspace).not.toHaveBeenCalled();
  });

  it("links a multi-transaction import to the transaction list", async () => {
    pageMocks.loadTransactionCapture.mockResolvedValue({
      kind: "imported",
      importedCount: 3,
      transactionIds: ["tx-1", "tx-2", "tx-3"]
    });

    const markup = await renderCapturePage(captureKey);

    expect(markup).toContain("3 transactions imported");
    expect(markup).toMatch(/href="\/transactions"[^>]*>View transactions</);
    expect(markup).not.toContain("tx-1");
  });

  it("falls back to the transaction list when an imported transaction is gone", async () => {
    pageMocks.loadTransactionCapture.mockResolvedValue({
      kind: "imported",
      importedCount: 1,
      transactionIds: []
    });

    const markup = await renderCapturePage(captureKey);

    expect(markup).toContain("Transaction imported");
    expect(markup).toMatch(/href="\/transactions"[^>]*>View transactions</);
  });

  it("explains a dismissed-only capture", async () => {
    pageMocks.loadTransactionCapture.mockResolvedValue({ kind: "dismissed" });

    const markup = await renderCapturePage(captureKey);

    expect(markup).toContain("Draft dismissed");
    expect(markup).toContain("Start another capture");
    expect(pageMocks.workspace).not.toHaveBeenCalled();
  });

  it("gives safe retry guidance when the capture cannot be loaded", async () => {
    pageMocks.loadTransactionCapture.mockResolvedValue({ kind: "failed" });

    const markup = await renderCapturePage(captureKey);

    expect(markup).toContain("Capture temporarily unavailable");
    expect(markup).toContain("Refresh the page to try again.");
    expect(markup).not.toContain(captureKey);
  });

  it("keeps remaining rows editable beneath a compact imported notice", async () => {
    const remaining = [{ id: "draft-2", status: "READY" }];
    pageMocks.loadTransactionCapture.mockResolvedValue({
      kind: "active",
      drafts: remaining,
      importedCount: 2
    });

    const markup = await renderCapturePage(captureKey);

    expect(markup).toContain("2 transactions already imported from this capture.");
    expect(markup).toMatch(/role="status"/);
    expect(pageMocks.workspace).toHaveBeenCalledWith(
      expect.objectContaining({
        initialCaptureKey: captureKey,
        initialDrafts: remaining
      }),
      undefined
    );
  });

  it("uses accessible 44px targets, visible focus, and reduced-motion links", async () => {
    pageMocks.loadTransactionCapture.mockResolvedValue({
      kind: "imported",
      importedCount: 1,
      transactionIds: ["tx-1"]
    });

    const markup = await renderCapturePage(captureKey);
    const links = markup.match(/<a [^>]*>(View transaction|Start another capture)<\/a>/g) ?? [];

    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain("min-h-11");
      expect(link).toContain("focus-visible:outline");
      expect(link).toContain("motion-reduce:transition-none");
    }
    expect(markup).toMatch(/<h2[^>]*>Transaction imported<\/h2>/);
    expect(markup).toContain("flex-wrap");
  });

  it("links both capture methods and marks quick and paste current", async () => {
    const markup = await renderCapturePage();

    expect(markup).toContain('href="/transactions/capture"');
    expect(markup).toContain("Quick and paste");
    expect(markup).toContain('href="/transactions/capture/email"');
    expect(markup).toContain("Email forwarding");
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/transactions\/capture"/);
  });

  it("makes capture the primary transaction action while retaining single entry", async () => {
    const markup = await renderTransactionsPage();

    expect(markup).toContain('href="/transactions/capture"');
    expect(markup).toContain("Capture transactions");
    expect(markup).toContain('href="/transactions/new"');
    expect(markup).toContain("Single entry");
    expect(markup).toContain('href="/transactions/capture/email"');
    expect(markup).toContain("Email forwarding");
    const emailLinkMarkup = markup.match(
      /<a[^>]*href="\/transactions\/capture\/email"[^>]*>[\s\S]*?<\/a>/
    )?.[0];
    expect(emailLinkMarkup).toBeDefined();
    expect(emailLinkMarkup).not.toContain("<button");
    const emailLinkOpeningTag = emailLinkMarkup?.match(/^<a[^>]*>/)?.[0];
    expect(emailLinkOpeningTag).toContain("min-h-11");
    expect(emailLinkOpeningTag).toContain("motion-reduce:transition-none");
    expect(emailLinkOpeningTag).toContain("focus-visible:outline");
  });

  it("confirms the imported batch count on the transaction list", async () => {
    const markup = await renderTransactionsPage({ created: "batch", count: "12" });

    expect(markup).toContain("Saved 12 transactions.");
  });
});
