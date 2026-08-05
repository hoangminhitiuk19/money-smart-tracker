// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { TransactionDraftView } from "@/lib/transaction-drafts/types";
import {
  CaptureWorkspace,
  type CaptureWorkspaceProps
} from "@/components/transaction-capture/CaptureWorkspace";
import { OriginStamp } from "@/components/transaction-capture/OriginStamp";
import { StatusRail } from "@/components/transaction-capture/StatusRail";

const workspaceProps: CaptureWorkspaceProps = {
  initialCaptureKey: null,
  initialDrafts: [],
  options: {
    categories: [],
    moneySources: [],
    projects: [],
    expenses: []
  },
  settings: {
    defaultCurrency: "VND",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "vi-VN"
  }
};

const draft: TransactionDraftView = {
  id: "draft-1",
  captureKey: "e52e1e80-780b-44bf-874f-508f59e0bd2f",
  position: 0,
  origin: "PASTE",
  status: "NEEDS_REVIEW",
  confidence: null,
  issues: [{ field: "amountText", message: "Enter an amount." }],
  type: "EXPENSE",
  amountText: null,
  currency: "VND",
  title: "Morning coffee",
  description: null,
  transactionDateText: "2026-08-05",
  categoryId: null,
  qualityRating: null,
  fromMoneySourceId: null,
  toMoneySourceId: null,
  adjustedMoneySourceId: null,
  adjustmentDirection: null,
  adjustmentTarget: null,
  projectId: null,
  relatedTransactionId: null,
  countTowardFeeWaiver: null,
  recurringPaymentId: null,
  isInstallmentRelated: false,
  duplicateConfirmed: false,
  rawRow: { Title: "Morning coffee" },
  importBatchId: null,
  importedTransactionId: null,
  expiresAt: "2026-09-04T00:00:00.000Z",
  possibleDuplicate: false
};

afterEach(cleanup);

describe("transaction capture visual system", () => {
  it("keeps pasted-row provenance visible and expands it for assistive technology", () => {
    render(<OriginStamp origin="PASTE" />);

    expect(screen.getByText("PASTE").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Pasted spreadsheet row").className).toContain(
      "sr-only"
    );
  });

  it("keeps quick-entry provenance visible and expands it for assistive technology", () => {
    render(<OriginStamp origin="QUICK" />);

    expect(screen.getByText("QUICK").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Quick entry").className).toContain("sr-only");
  });

  it("describes review status and issue count without relying on color", () => {
    const markup = renderToStaticMarkup(
      <StatusRail status="NEEDS_REVIEW" issueCount={2} />
    );

    expect(markup).toContain("Needs review");
    expect(markup).toContain("2 issues");
    expect(markup).toContain("role=\"status\"");
  });

  it("uses singular issue copy and names ready rows", () => {
    const reviewMarkup = renderToStaticMarkup(
      <StatusRail status="NEEDS_REVIEW" issueCount={1} />
    );
    const readyMarkup = renderToStaticMarkup(
      <StatusRail status="READY" issueCount={0} />
    );

    expect(reviewMarkup).toContain("1 issue");
    expect(reviewMarkup).not.toContain("1 issues");
    expect(readyMarkup).toContain("Ready");
  });

  it("renders accessible capture modes, a planned email affordance, and corrective empty copy", () => {
    const markup = renderToStaticMarkup(
      <CaptureWorkspace {...workspaceProps} />
    );

    expect(markup).toContain("Capture transactions");
    expect(markup).toContain("Quick add");
    expect(markup).toContain("Paste rows");
    expect(markup).toMatch(/disabled=\"\"[^>]*>[^<]*Email|disabled=\"\"/);
    expect(markup).toContain("Planned");
    expect(markup).toContain("Start with one transaction or paste a spreadsheet");
    expect(markup).toContain("role=\"tablist\"");
  });

  it("moves the active panel between quick and paste modes while email stays unavailable", async () => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...workspaceProps} />);

    const quickTab = screen.getByRole("tab", { name: "Quick add" });
    const pasteTab = screen.getByRole("tab", { name: "Paste rows" });
    const emailTab = screen.getByRole("tab", { name: "Email (planned)" });

    expect(quickTab.getAttribute("aria-selected")).toBe("true");
    expect(quickTab.tabIndex).toBe(0);
    expect(pasteTab.tabIndex).toBe(-1);
    expect(emailTab.tabIndex).toBe(-1);
    expect(emailTab.getAttribute("aria-selected")).toBe("false");
    expect((emailTab as HTMLButtonElement).disabled).toBe(true);

    const quickPanelId = quickTab.getAttribute("aria-controls");
    const quickPanel = quickPanelId
      ? document.getElementById(quickPanelId)
      : null;
    expect(quickPanel?.getAttribute("aria-labelledby")).toBe(quickTab.id);

    await user.click(pasteTab);

    expect(pasteTab.getAttribute("aria-selected")).toBe("true");
    expect(pasteTab.tabIndex).toBe(0);
    expect(quickTab.getAttribute("aria-selected")).toBe("false");
    expect(quickTab.tabIndex).toBe(-1);
    expect(
      screen.getByRole("tabpanel", { name: "Paste rows" }).textContent
    ).toContain("Bring in spreadsheet rows");

    const activePanelId = pasteTab.getAttribute("aria-controls");
    const activePanel = activePanelId
      ? document.getElementById(activePanelId)
      : null;
    expect(activePanel?.getAttribute("aria-labelledby")).toBe(pasteTab.id);

    const emailPanelId = emailTab.getAttribute("aria-controls");
    const emailPanel = emailPanelId
      ? document.getElementById(emailPanelId)
      : null;
    expect(emailPanel?.hidden).toBe(true);
    expect(emailPanel?.getAttribute("aria-labelledby")).toBe(emailTab.id);
  });

  it("moves focus and selection with arrow, Home, and End keys while skipping planned email", async () => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...workspaceProps} />);

    const quickTab = screen.getByRole("tab", { name: "Quick add" });
    const pasteTab = screen.getByRole("tab", { name: "Paste rows" });
    const emailTab = screen.getByRole("tab", { name: "Email (planned)" });

    quickTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(pasteTab);
    expect(pasteTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(quickTab);
    expect(quickTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(pasteTab);
    expect(pasteTab.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(quickTab);
    expect(quickTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).not.toBe(emailTab);

    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(pasteTab);
    expect(pasteTab.getAttribute("aria-selected")).toBe("true");
  });

  it("hydrates stable workspace relationships when React identifier prefixes differ", async () => {
    const captureKey = "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36";
    const props = { ...workspaceProps, initialCaptureKey: captureKey };
    const container = document.createElement("div");
    container.innerHTML = renderToString(<CaptureWorkspace {...props} />, {
      identifierPrefix: "server-"
    });
    document.body.append(container);

    const consoleErrors: unknown[][] = [];
    const originalConsoleError = console.error;
    let root: Root | null = null;
    console.error = (...arguments_) => {
      consoleErrors.push(arguments_);
    };

    try {
      await act(async () => {
        root = hydrateRoot(container, <CaptureWorkspace {...props} />, {
          identifierPrefix: "client-"
        });
      });

      expect(consoleErrors).toEqual([]);
      expect(
        container.querySelector('[role="tab"]')?.id
      ).toBe(`capture-workspace-${captureKey}-quick-tab`);
    } finally {
      await act(async () => {
        root?.unmount();
      });
      console.error = originalConsoleError;
      container.remove();
    }
  });

  it("provides responsive review regions and removes row-settling transitions for reduced motion", () => {
    const markup = renderToStaticMarkup(
      <CaptureWorkspace
        {...workspaceProps}
        initialDrafts={[draft]}
      />
    );

    expect(markup).toMatch(
      /class=\"[^\"]*hidden[^\"]*lg:block[^\"]*\" data-testid=\"capture-desktop-ledger\"/
    );
    expect(markup).toMatch(
      /class=\"[^\"]*lg:hidden[^\"]*\" data-testid=\"capture-mobile-cards\"/
    );
    expect(markup).toContain("motion-reduce:transition-none");
    expect(markup).toContain("transition-[opacity,transform]");
    expect(markup).not.toContain("transition-colors");
    expect(markup).not.toContain("animate-pulse");
  });
});
