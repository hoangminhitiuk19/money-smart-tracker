// @vitest-environment jsdom

import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  QualityRating,
  TransactionType
} from "@prisma/client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CaptureWorkspace,
  type CaptureWorkspaceProps
} from "@/components/transaction-capture/CaptureWorkspace";
import type { TransactionDraftView } from "@/lib/transaction-drafts/types";

const mocks = vi.hoisted(() => ({
  dismissTransactionDrafts: vi.fn(),
  importTransactionDrafts: vi.fn(),
  savePasteDrafts: vi.fn(),
  saveQuickDraft: vi.fn(),
  updateTransactionDraft: vi.fn()
}));

vi.mock("@/lib/actions/transaction-drafts", () => ({
  dismissTransactionDrafts: mocks.dismissTransactionDrafts,
  importTransactionDrafts: mocks.importTransactionDrafts,
  savePasteDrafts: mocks.savePasteDrafts,
  saveQuickDraft: mocks.saveQuickDraft,
  updateTransactionDraft: mocks.updateTransactionDraft
}));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation
}));

const captureKey = "550e8400-e29b-41d4-a716-446655440000";

const props: CaptureWorkspaceProps = {
  initialCaptureKey: captureKey,
  initialDrafts: [],
  options: {
    categories: [
      {
        id: "food",
        name: "Ăn uống",
        defaultQualityRating: QualityRating.A
      },
      { id: "salary", name: "Lương", defaultQualityRating: null }
    ],
    moneySources: [
      { id: "wallet", name: "Ví tiền", type: MoneySourceType.CASH },
      { id: "bank", name: "Tài khoản ngân hàng", type: MoneySourceType.BANK_ACCOUNT },
      { id: "card", name: "Thẻ tín dụng", type: MoneySourceType.CREDIT_CARD }
    ],
    projects: [{ id: "trip", name: "Du lịch" }],
    expenses: [
      {
        id: "expense-1",
        name: "Bữa trưa",
        amount: "125000.50",
        transactionDate: "2026-08-02"
      }
    ]
  },
  settings: {
    defaultCurrency: "VND",
    dateFormat: "DD/MM/YYYY",
    numberFormat: "vi-VN"
  }
};

function persistedDraft(overrides: Partial<TransactionDraftView> = {}): TransactionDraftView {
  return {
    id: "draft-1",
    captureKey,
    position: 0,
    origin: "PASTE",
    status: "NEEDS_REVIEW",
    confidence: null,
    issues: [],
    type: TransactionType.EXPENSE,
    amountText: "45000",
    currency: "VND",
    title: "Cà phê sáng",
    description: null,
    transactionDateText: "2026-08-03",
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
    countTowardFeeWaiverTouched: false,
    qualityRatingTouched: false,
    recurringPaymentId: null,
    isInstallmentRelated: false,
    duplicateConfirmed: false,
    duplicateAcknowledgementRequired: false,
    invalidMappedFields: [],
    rawRow: { Date: "2026-08-03", Title: "Cà phê sáng", Amount: "45000" },
    importBatchId: null,
    importedTransactionId: null,
    expiresAt: "2026-09-02T00:00:00.000Z",
    possibleDuplicate: false,
    ...overrides
  };
}

async function openPaste(user: ReturnType<typeof userEvent.setup>) {
  render(<CaptureWorkspace {...props} />);
  await user.click(screen.getByRole("tab", { name: "Paste rows" }));
}

async function pasteRows(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByLabelText("Paste spreadsheet rows"));
  await user.paste(text);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/transactions/capture");
  vi.clearAllMocks();
  mocks.savePasteDrafts.mockResolvedValue({
    ok: true,
    drafts: [persistedDraft()]
  });
  mocks.saveQuickDraft.mockImplementation(async (input: Partial<TransactionDraftView>) => ({
    ok: true,
    draft: persistedDraft({ id: "quick-draft", ...input, origin: "QUICK", status: "READY" })
  }));
  mocks.importTransactionDrafts.mockResolvedValue({
    ok: true,
    importedCount: 1,
    transactionIds: ["transaction-1"]
  });
  mocks.dismissTransactionDrafts.mockResolvedValue({
    ok: true,
    dismissedCount: 1,
    dismissedIds: ["draft-1"]
  });
  mocks.updateTransactionDraft.mockImplementation(
    async (id: string, patch: Partial<TransactionDraftView>) => ({
      ok: true,
      draft: persistedDraft({ id, ...patch })
    })
  );
});

afterEach(cleanup);

describe("spreadsheet transaction capture", () => {
  it("starts a compact quick draft with today's date and the configured currency", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T08:00:00.000Z"));
    try {
      render(<CaptureWorkspace {...props} />);
      fireEvent.click(screen.getByRole("tab", { name: "Quick add" }));

      expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-08-03");
      expect((screen.getByLabelText("Currency") as HTMLInputElement).value).toBe("VND");
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves a quick draft into a fresh capture without reusing a pasted capture", async () => {
    const user = userEvent.setup();
    const pasted = persistedDraft({ origin: "PASTE", status: "READY" });
    render(<CaptureWorkspace {...props} initialDrafts={[pasted]} />);

    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    await user.type(screen.getByLabelText("Title"), "Lunch");
    await user.type(screen.getByLabelText("Amount"), "45000");
    await user.selectOptions(screen.getByLabelText("Source"), "wallet");
    await user.click(screen.getByRole("button", { name: "Save quick draft" }));

    await waitFor(() => expect(mocks.saveQuickDraft).toHaveBeenCalledOnce());
    expect(mocks.saveQuickDraft.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        captureKey: expect.not.stringMatching(new RegExp(`^${captureKey}$`)),
        origin: "QUICK",
        position: 0,
        amountText: "45000",
        title: "Lunch",
        fromMoneySourceId: "wallet"
      })
    );
    expect(await screen.findByText("Lunch")).not.toBeNull();
  });

  it("summarizes selected ready drafts and saves them as one atomic batch", async () => {
    const user = userEvent.setup();
    const ready = persistedDraft({ id: "ready", status: "READY" });
    const review = persistedDraft({
      id: "review",
      position: 1,
      status: "NEEDS_REVIEW",
      issues: [{ field: "title", message: "Add a title." }]
    });
    render(<CaptureWorkspace {...props} initialDrafts={[ready, review]} />);
    const ledger = screen.getByTestId("capture-desktop-ledger");

    expect(screen.getByText("1 ready · 1 need attention")).not.toBeNull();
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    expect((screen.getByRole("button", { name: "Save 1 transaction" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Save 1 transaction" }));

    await waitFor(() => expect(mocks.importTransactionDrafts).toHaveBeenCalledOnce());
    expect(mocks.importTransactionDrafts).toHaveBeenCalledWith({
      ids: ["ready"],
      idempotencyKey: expect.any(String)
    });
    expect(navigation.push).toHaveBeenCalledWith("/transactions?created=batch&count=1");
  });

  it("shows selected, ready, review, and duplicate counts while blocking empty and non-ready selections", async () => {
    const user = userEvent.setup();
    const ready = persistedDraft({ id: "ready", status: "READY" });
    const review = persistedDraft({
      id: "review",
      position: 1,
      status: "NEEDS_REVIEW",
      possibleDuplicate: true,
      issues: [{ field: "title", message: "Add a title." }]
    });
    render(<CaptureWorkspace {...props} initialDrafts={[ready, review]} />);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const save = screen.getByRole("button", { name: "Save selected transactions" });

    expect(screen.getByText("0 selected · 1 ready · 1 need attention · 1 duplicate")).not.toBeNull();
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    expect(screen.getByText("1 selected · 1 ready · 1 need attention · 1 duplicate")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Save 1 transaction" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 2" }));
    expect(screen.getByText("2 selected · 1 ready · 1 need attention · 1 duplicate")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Save selected transactions" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks import while a selected row has a local edit that has not been saved", async () => {
    const user = userEvent.setup();
    render(
      <CaptureWorkspace
        {...props}
        initialDrafts={[persistedDraft({ status: "READY" })]}
      />
    );
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    const title = within(ledger).getByRole("textbox", {
      name: "Row 1 title"
    });

    await user.clear(title);
    await user.type(title, "Unsaved coffee");

    expect(
      screen.getByText("1 selected row has unsaved changes.")
    ).not.toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Save selected transactions"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(mocks.importTransactionDrafts).not.toHaveBeenCalled();
  });

  it("waits for a selected row patch before enabling import", async () => {
    const user = userEvent.setup();
    let finishPatch: (() => void) | undefined;
    mocks.updateTransactionDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPatch = () =>
            resolve({
              ok: true,
              draft: persistedDraft({
                status: "READY",
                title: "Saved coffee"
              })
            });
        })
    );
    render(
      <CaptureWorkspace
        {...props}
        initialDrafts={[persistedDraft({ status: "READY" })]}
      />
    );
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    const title = within(ledger).getByRole("textbox", {
      name: "Row 1 title"
    });
    await user.clear(title);
    await user.type(title, "Saved coffee");
    await user.tab();

    expect(
      screen.getByText("Wait for 1 selected row to finish saving.")
    ).not.toBeNull();
    expect(mocks.importTransactionDrafts).not.toHaveBeenCalled();

    finishPatch?.();
    expect(
      await screen.findByRole("button", { name: "Save 1 transaction" })
    ).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Save 1 transaction" })
    );
    await waitFor(() =>
      expect(mocks.importTransactionDrafts).toHaveBeenCalledOnce()
    );
  });

  it("keeps import blocked when a delayed selected-row patch fails", async () => {
    const user = userEvent.setup();
    let failPatch: (() => void) | undefined;
    mocks.updateTransactionDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          failPatch = () =>
            resolve({ ok: false, error: "Draft update failed." });
        })
    );
    render(
      <CaptureWorkspace
        {...props}
        initialDrafts={[persistedDraft({ status: "READY" })]}
      />
    );
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    const amount = within(ledger).getByRole("textbox", {
      name: "Row 1 amount"
    });
    await user.clear(amount);
    await user.type(amount, "55.00");
    await user.tab();
    failPatch?.();

    expect(
      await screen.findByText("Row 1 was not saved: Draft update failed.")
    ).not.toBeNull();
    expect(
      screen.getByText("1 selected row has unsaved changes.")
    ).not.toBeNull();
    expect(mocks.importTransactionDrafts).not.toHaveBeenCalled();
  });

  it("requires dismissal confirmation and restores focus when cancelled", async () => {
    const user = userEvent.setup();
    render(
      <CaptureWorkspace
        {...props}
        initialDrafts={[persistedDraft({ status: "READY" })]}
      />
    );
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    const dismiss = screen.getByRole("button", { name: "Dismiss selected" });
    dismiss.focus();
    await user.click(dismiss);

    expect(
      screen.getByRole("dialog", { name: "Dismiss 1 draft?" })
    ).not.toBeNull();
    expect(screen.getByText(/candidate values will be deleted/i)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(dismiss);
    expect(mocks.dismissTransactionDrafts).not.toHaveBeenCalled();
  });

  it("removes only server-confirmed dismissed rows and focuses the next row", async () => {
    const user = userEvent.setup();
    mocks.dismissTransactionDrafts.mockResolvedValueOnce({
      ok: true,
      dismissedCount: 1,
      dismissedIds: ["draft-1"]
    });
    render(
      <CaptureWorkspace
        {...props}
        initialDrafts={[
          persistedDraft({ id: "draft-1", status: "READY" }),
          persistedDraft({
            id: "draft-2",
            position: 1,
            status: "READY",
            title: "Bánh mì"
          }),
          persistedDraft({
            id: "draft-3",
            position: 2,
            status: "READY",
            title: "Trà đá"
          })
        ]}
      />
    );
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 2" })
    );
    await user.click(screen.getByRole("button", { name: "Dismiss selected" }));
    await user.click(screen.getByRole("button", { name: "Dismiss drafts" }));

    await waitFor(() =>
      expect(mocks.dismissTransactionDrafts).toHaveBeenCalledWith([
        "draft-1",
        "draft-2"
      ])
    );
    expect(
      await screen.findByText(
        "Dismissed 1 of 2 drafts. 1 draft could not be dismissed."
      )
    ).not.toBeNull();
    expect(within(ledger).queryByDisplayValue("Cà phê sáng")).toBeNull();
    expect(within(ledger).getByDisplayValue("Bánh mì")).not.toBeNull();
    expect(within(ledger).getByDisplayValue("Trà đá")).not.toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(ledger).getByRole("checkbox", { name: "Select row 1" })
      )
    );
  });

  it("keeps the dismissal dialog recoverable when the server fails", async () => {
    const user = userEvent.setup();
    let failDismissal: (() => void) | undefined;
    mocks.dismissTransactionDrafts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          failDismissal = () =>
            resolve({ ok: false, error: "Draft dismissal failed." });
        })
    );
    render(
      <CaptureWorkspace
        {...props}
        initialDrafts={[persistedDraft({ status: "READY" })]}
      />
    );
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    await user.click(screen.getByRole("button", { name: "Dismiss selected" }));
    await user.click(screen.getByRole("button", { name: "Dismiss drafts" }));

    expect(
      (screen.getByRole("button", {
        name: "Dismissing drafts"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    failDismissal?.();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Draft dismissal failed."
    );
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(within(ledger).getByDisplayValue("Cà phê sáng")).not.toBeNull();
  });

  it("focuses the draft returned by a domain import failure", async () => {
    const user = userEvent.setup();
    const first = persistedDraft({ id: "first", status: "READY" });
    const affected = persistedDraft({ id: "affected", position: 1, status: "READY" });
    mocks.importTransactionDrafts.mockResolvedValueOnce({
      ok: false,
      error: "The source is no longer available.",
      draftId: "affected"
    });
    render(<CaptureWorkspace {...props} initialDrafts={[first, affected]} />);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    await user.click(screen.getByRole("button", { name: "Save 1 transaction" }));

    expect(await screen.findByText("The source is no longer available.")).not.toBeNull();
    expect(document.activeElement).toBe(
      within(ledger).getByRole("checkbox", { name: "Select row 2" })
    );
  });

  it("requires quick essentials and remembers the last explicit source and category for the next quick entry", async () => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...props} initialCaptureKey={null} />);
    await user.click(screen.getByRole("tab", { name: "Quick add" }));

    expect((screen.getByRole("button", { name: "Save quick draft" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Title"), "Lunch");
    await user.type(screen.getByLabelText("Amount"), "45000");
    expect((screen.getByRole("button", { name: "Save quick draft" }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText("Source"), "wallet");
    await user.selectOptions(screen.getByLabelText("Category"), "food");
    await user.click(screen.getByRole("button", { name: "Save quick draft" }));
    await user.click(await screen.findByRole("button", { name: "Add another quick entry" }));

    expect((screen.getByLabelText("Source") as HTMLSelectElement).value).toBe("wallet");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("food");
  });

  it("keeps an honest return path to pasted rows while a quick draft starts separately", async () => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...props} initialDrafts={[persistedDraft({ origin: "PASTE" })]} />);
    await user.click(screen.getByRole("tab", { name: "Quick add" }));

    expect(screen.getByText("Your pasted rows stay separate while you add one quick transaction.")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Return to pasted rows" }).getAttribute("href")).toBe(`/transactions/capture?capture=${captureKey}`);
  });

  it("keeps the pasted-capture return path after a quick draft replaces the active review", async () => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...props} initialDrafts={[persistedDraft({ origin: "PASTE" })]} />);
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    await user.type(screen.getByLabelText("Title"), "Quick lunch");
    await user.type(screen.getByLabelText("Amount"), "45000");
    await user.selectOptions(screen.getByLabelText("Source"), "wallet");
    await user.click(screen.getByRole("button", { name: "Save quick draft" }));

    const returnLink = await screen.findByRole("link", { name: "Return to pasted rows" });
    expect(returnLink.getAttribute("href")).toBe(`/transactions/capture?capture=${captureKey}`);
    expect(window.location.search).not.toBe(`?capture=${captureKey}`);
  });

  it("clears incompatible expense fields before a quick income draft is saved", async () => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...props} initialCaptureKey={null} />);
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    await user.type(screen.getByLabelText("Title"), "Salary");
    await user.type(screen.getByLabelText("Amount"), "45000");
    await user.selectOptions(screen.getByLabelText("Source"), "wallet");
    await user.selectOptions(screen.getByLabelText("Type"), TransactionType.INCOME);
    await user.selectOptions(screen.getByLabelText("Destination"), "bank");
    await user.click(screen.getByRole("button", { name: "Save quick draft" }));

    expect(mocks.saveQuickDraft).toHaveBeenCalledWith(expect.objectContaining({
      type: TransactionType.INCOME,
      fromMoneySourceId: null,
      toMoneySourceId: "bank",
      countTowardFeeWaiver: false
    }));
  });

  it("clears transfer-only fields before a quick expense draft is saved", async () => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...props} initialCaptureKey={null} />);
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    await user.selectOptions(screen.getByLabelText("Type"), TransactionType.TRANSFER);
    await user.selectOptions(screen.getByLabelText("Source"), "wallet");
    await user.selectOptions(screen.getByLabelText("Destination"), "bank");
    await user.selectOptions(screen.getByLabelText("Type"), TransactionType.EXPENSE);
    await user.type(screen.getByLabelText("Title"), "Coffee");
    await user.type(screen.getByLabelText("Amount"), "45000");
    await user.selectOptions(screen.getByLabelText("Source"), "card");
    await user.click(screen.getByRole("button", { name: "Save quick draft" }));

    expect(mocks.saveQuickDraft).toHaveBeenCalledWith(expect.objectContaining({
      type: TransactionType.EXPENSE,
      fromMoneySourceId: "card",
      toMoneySourceId: null
    }));
  });

  it.each([
    TransactionType.INCOME,
    TransactionType.EXPENSE,
    TransactionType.TRANSFER,
    TransactionType.REFUND,
    TransactionType.ADJUSTMENT
  ])("makes a %s quick type start without fields incompatible with that type", async (type) => {
    const user = userEvent.setup();
    render(<CaptureWorkspace {...props} initialCaptureKey={null} />);
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    await user.selectOptions(screen.getByLabelText("Type"), type);

    if (type === TransactionType.INCOME || type === TransactionType.REFUND) {
      expect(screen.getByLabelText("Destination")).not.toBeNull();
    } else if (type === TransactionType.ADJUSTMENT) {
      expect(screen.getByLabelText("Adjusted source")).not.toBeNull();
      expect(screen.getByLabelText("Direction")).not.toBeNull();
    } else {
      expect(screen.getByLabelText("Source")).not.toBeNull();
    }
  });

  it("focuses the mobile draft card at an 800px viewport when a domain import failure occurs", async () => {
    const user = userEvent.setup();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(max-width: 1023px)",
        media: query
      })
    });
    try {
      const first = persistedDraft({ id: "first", status: "READY" });
      const affected = persistedDraft({ id: "affected", position: 1, status: "READY" });
      mocks.importTransactionDrafts.mockResolvedValueOnce({ ok: false, error: "Review row 2.", draftId: "affected" });
      render(<CaptureWorkspace {...props} initialDrafts={[first, affected]} />);
      const cards = screen.getByTestId("capture-mobile-cards");
      await user.click(within(cards).getByRole("checkbox", { name: "Select row 1" }));
      await user.click(screen.getByRole("button", { name: "Save 1 transaction" }));

      await screen.findByText("Review row 2.");
      expect(document.activeElement).toBe(document.getElementById("mobile-draft-affected"));
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });

  it("keeps the same idempotency key and selection after a network failure", async () => {
    const user = userEvent.setup();
    mocks.importTransactionDrafts
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ ok: true, importedCount: 1, transactionIds: ["transaction-1"] });
    render(<CaptureWorkspace {...props} initialDrafts={[persistedDraft({ status: "READY" })]} />);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    await user.click(screen.getByRole("button", { name: "Save 1 transaction" }));

    expect((await screen.findByRole("button", { name: "Try saving again" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(ledger).getByRole("checkbox", { name: "Select row 1" }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Try saving again" }));
    await waitFor(() => expect(mocks.importTransactionDrafts).toHaveBeenCalledTimes(2));
    expect(mocks.importTransactionDrafts.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        ids: ["draft-1"],
        idempotencyKey: mocks.importTransactionDrafts.mock.calls[0][0].idempotencyKey
      })
    );
  });

  it("replaces a failed retry key only after the user abandons that attempt", async () => {
    const user = userEvent.setup();
    mocks.importTransactionDrafts.mockRejectedValue(new Error("network unavailable"));
    render(<CaptureWorkspace {...props} initialDrafts={[persistedDraft({ status: "READY" })]} />);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    await user.click(screen.getByRole("button", { name: "Save 1 transaction" }));
    await screen.findByRole("button", { name: "Try saving again" });
    const firstKey = mocks.importTransactionDrafts.mock.calls[0][0].idempotencyKey;

    await user.click(screen.getByRole("button", { name: "Abandon this save attempt" }));
    await user.click(screen.getByRole("button", { name: "Save 1 transaction" }));
    await waitFor(() => expect(mocks.importTransactionDrafts).toHaveBeenCalledTimes(2));
    expect(mocks.importTransactionDrafts.mock.calls[1][0].idempotencyKey).not.toBe(firstKey);
  });
  it("detects TSV columns, Unicode content, exact money text, and previews three rows", async () => {
    const user = userEvent.setup();
    await openPaste(user);

    await pasteRows(
      user,
      "Date\tTitle\tAmount\n2026-08-03\tCà phê sáng\t90071992547409.99\n2026-08-04\tBánh mì\t25000\n2026-08-05\tTrà đá\t5000\n2026-08-06\tXe buýt\t7000"
    );

    expect(await screen.findByText("4 rows detected")).not.toBeNull();
    expect(screen.getByText(/\d+ \/ 1,000,000 bytes/)).not.toBeNull();
    expect((screen.getByLabelText("Amount column") as HTMLSelectElement).value).toBe("2");
    expect((screen.getByLabelText("Title column") as HTMLSelectElement).value).toBe("1");
    const preview = screen.getByRole("table", { name: "Mapped row preview" });
    expect(within(preview).getByText("Cà phê sáng")).not.toBeNull();
    expect(within(preview).getByText("90071992547409.99")).not.toBeNull();
    expect(within(preview).queryByText("Xe buýt")).toBeNull();
  });

  it("blocks ambiguous duplicate headers until they are resolved and prevents column reuse", async () => {
    const user = userEvent.setup();
    await openPaste(user);

    await pasteRows(
      user,
      "Date\tTitle\tAmount\tAmount\n2026-08-03\tCoffee\t45000\tVND"
    );

    expect(await screen.findByText("Choose which Amount column to use.")).not.toBeNull();
    const review = screen.getByRole("button", { name: "Review rows" });
    expect((review as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText("Amount column"), "2");
    expect((review as HTMLButtonElement).disabled).toBe(false);
    const usedColumnOption = (
      within(screen.getByLabelText("Currency column")).getByRole("option", {
        name: /Amount.*45000/
      })
    ) as HTMLOptionElement;
    expect(usedColumnOption.disabled).toBe(true);
  });

  it.each([
    [TransactionType.INCOME, ["Date", "Title", "Amount", "To account"], ["From account"]],
    [TransactionType.EXPENSE, ["Date", "Title", "Amount", "From account"], ["To account"]],
    [TransactionType.TRANSFER, ["Date", "Title", "Amount", "From account", "To account"], []],
    [TransactionType.REFUND, ["Date", "Title", "Amount", "To account"], ["From account"]],
    [TransactionType.ADJUSTMENT, ["Date", "Title", "Amount", "Adjustment direction"], ["From account", "To account"]]
  ])(
    "shows the complete %s mapping guidance",
    async (type, requiredFields, optionalFields) => {
      const user = userEvent.setup();
      await openPaste(user);
      await pasteRows(
        user,
        "Date,Title,Amount,From,To,Adjustment direction\n2026-08-03,Coffee,45000,Wallet,Card,Increase"
      );

      await user.selectOptions(
        await screen.findByLabelText("Default transaction type"),
        type
      );

      for (const field of requiredFields) {
        expect(
          screen.getByLabelText(`${field} column`).closest("label")?.textContent
        ).toContain("Required");
      }
      for (const field of optionalFields) {
        expect(
          screen.getByLabelText(`${field} column`).closest("label")?.textContent
        ).not.toContain("Required");
      }
      if (type === TransactionType.ADJUSTMENT) {
        expect(
          screen.getByRole("button", { name: "Review rows" }).parentElement
            ?.textContent
        ).toContain("Choose the adjusted account during row review.");
      }
    }
  );

  it("bounds a user-controlled source heading in preflight errors", async () => {
    const user = userEvent.setup();
    const longHeading = `Dangerous\u202E reference ${"Dangerous reference ".repeat(20)}`.trim();
    const input = `Date,Title,Amount,${longHeading}\n2026-08-03,Coffee,45000,${"R".repeat(10_001)}`;
    await openPaste(user);
    await pasteRows(user, input);

    await user.click(
      await screen.findByRole("button", { name: "Review rows" })
    );

    const error = (await screen.findByRole("alert")).textContent ?? "";
    expect(error).toContain("Dangerous reference Dangerous reference");
    expect(error).not.toContain("\u202E");
    expect(error).toContain("…” source column cannot exceed 10,000 characters");
    expect(error.length).toBeLessThan(220);
    expect(mocks.savePasteDrafts).not.toHaveBeenCalled();
  });

  it("persists mapped text and replaces the URL only after the server succeeds", async () => {
    const user = userEvent.setup();
    const existingHistoryState = { captureSentinel: "keep-existing-state" };
    window.history.replaceState(
      existingHistoryState,
      "",
      "/transactions/capture"
    );
    await openPaste(user);
    const input = "Date,Title,Amount\n2026-08-03,Coffee,90071992547409.99";

    await pasteRows(user, input);
    await user.click(await screen.findByRole("button", { name: "Review rows" }));

    await waitFor(() => expect(mocks.savePasteDrafts).toHaveBeenCalledOnce());
    expect(mocks.savePasteDrafts).toHaveBeenCalledWith({
      captureKey,
      rows: [
        expect.objectContaining({
          captureKey,
          position: 0,
          origin: "PASTE",
          type: TransactionType.EXPENSE,
          amountText: "90071992547409.99",
          currency: "VND",
          title: "Coffee",
          transactionDateText: "2026-08-03"
        })
      ]
    });
    expect(window.location.search).toBe(`?capture=${captureKey}`);
    expect(window.history.state).toEqual(existingHistoryState);
  });

  it("keeps an invalid pasted quality enum blocking and field-visible", async () => {
    const user = userEvent.setup();
    const issue = "Choose S, A, B, C, or D for the quality rating.";
    mocks.savePasteDrafts.mockImplementationOnce(async ({ rows }) => ({
      ok: true,
      drafts: [
        persistedDraft({
          ...rows[0],
          status: "NEEDS_REVIEW",
          invalidMappedFields: ["qualityRating"],
          issues: [{ field: "qualityRating", message: issue }]
        })
      ]
    }));
    await openPaste(user);
    await pasteRows(
      user,
      "Date,Title,Amount,From,Quality\n2026-08-03,Coffee,45000,Ví tiền,Z"
    );
    await user.click(await screen.findByRole("button", { name: "Review rows" }));

    await waitFor(() => expect(mocks.savePasteDrafts).toHaveBeenCalledOnce());
    expect(mocks.savePasteDrafts.mock.calls[0][0].rows[0]).toEqual(
      expect.objectContaining({
        fromMoneySourceId: "wallet",
        qualityRating: null,
        invalidMappedFields: ["qualityRating"]
      })
    );
    const ledger = screen.getByTestId("capture-desktop-ledger");
    expect(
      within(ledger).getByRole("status", { name: "Needs review, 1 issue" })
    ).not.toBeNull();
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 1" })
    );
    expect(within(ledger).getByRole("button", { name: issue })).not.toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Save selected transactions"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it.each([
    {
      name: "title",
      input: `Date,Title,Amount\n2026-08-03,${"T".repeat(201)},45000`,
      error: "Row 1: Title cannot exceed 200 characters. Shorten this value and try again."
    },
    {
      name: "amount",
      input: `Date,Title,Amount\n2026-08-03,Coffee,${"9".repeat(65)}`,
      error: "Row 1: Amount cannot exceed 64 characters. Shorten this value and try again."
    },
    {
      name: "raw source value",
      input: `Date,Title,Amount,Reference\n2026-08-03,Coffee,45000,${"R".repeat(10_001)}`,
      error: 'Row 1: “Reference” source column cannot exceed 10,000 characters. Shorten this value and try again.'
    }
  ])(
    "preflights an overlong $name before persistence",
    async ({ input, error }) => {
      const user = userEvent.setup();
      await openPaste(user);
      await pasteRows(user, input);

      await user.click(
        await screen.findByRole("button", { name: "Review rows" })
      );

      expect((await screen.findByRole("alert")).textContent).toBe(error);
      expect(
        (screen.getByLabelText(
          "Paste spreadsheet rows"
        ) as HTMLTextAreaElement).value
      ).toBe(input);
      expect(mocks.savePasteDrafts).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    }
  );

  it("defaults missing dates to the user's local calendar day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 1, 0, 0));
    try {
      render(<CaptureWorkspace {...props} />);
      fireEvent.click(screen.getByRole("tab", { name: "Paste rows" }));
      fireEvent.change(screen.getByLabelText("Paste spreadsheet rows"), {
        target: { value: "Title,Amount\nCoffee,45000" }
      });
      fireEvent.click(screen.getByRole("button", { name: "Review rows" }));
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mocks.savePasteDrafts).toHaveBeenCalledWith({
        captureKey,
        rows: [expect.objectContaining({ transactionDateText: "2026-08-04" })]
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves pasted input and the current URL when persistence fails", async () => {
    mocks.savePasteDrafts.mockResolvedValueOnce({
      ok: false,
      error: "Drafts could not be saved. Try again."
    });
    const user = userEvent.setup();
    await openPaste(user);
    const input = "Date,Title,Amount\n2026-08-03,Coffee,45000";

    await pasteRows(user, input);
    await user.click(await screen.findByRole("button", { name: "Review rows" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Drafts could not be saved. Try again."
    );
    expect((screen.getByLabelText("Paste spreadsheet rows") as HTMLTextAreaElement).value).toBe(input);
    expect(window.location.search).toBe("");
  });

  it("keeps one generated capture key across a rejected save and retry", async () => {
    const generatedCaptureKey = "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36";
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(generatedCaptureKey);
    mocks.savePasteDrafts
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ ok: true, drafts: [persistedDraft({ captureKey: generatedCaptureKey })] });
    const user = userEvent.setup();
    render(<CaptureWorkspace {...props} initialCaptureKey={null} />);
    await user.click(screen.getByRole("tab", { name: "Paste rows" }));
    const input = "Date,Title,Amount\n2026-08-03,Coffee,45000";
    await pasteRows(user, input);
    const review = await screen.findByRole("button", { name: "Review rows" });

    await user.click(review);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Drafts could not be saved. Check your connection and try again."
    );
    expect((screen.getByLabelText("Paste spreadsheet rows") as HTMLTextAreaElement).value).toBe(input);
    await user.click(review);

    await waitFor(() => expect(mocks.savePasteDrafts).toHaveBeenCalledTimes(2));
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(mocks.savePasteDrafts.mock.calls.map(([value]) => value.captureKey)).toEqual([
      generatedCaptureKey,
      generatedCaptureKey
    ]);
    expect(window.location.search).toBe(`?capture=${generatedCaptureKey}`);
  });

  it("keeps oversized and over-row-limit input available for correction", async () => {
    const user = userEvent.setup();
    await openPaste(user);
    const textarea = screen.getByLabelText("Paste spreadsheet rows");
    const oversized = `Date,Title,Amount\n2026-08-03,Coffee,${"1".repeat(1_000_000)}`;

    fireEvent.change(textarea, { target: { value: oversized } });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Paste input cannot exceed 1,000,000 UTF-8 bytes. Remove some rows or split the batch."
    );
    expect((textarea as HTMLTextAreaElement).value).toBe(oversized);

    const tooManyRows = [
      "Date,Title,Amount",
      ...Array.from({ length: 201 }, (_, index) => `2026-08-03,Coffee ${index},45000`)
    ].join("\n");
    fireEvent.change(textarea, { target: { value: tooManyRows } });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Paste input cannot contain more than 200 rows. Remove a row or split the batch."
    );
    expect((textarea as HTMLTextAreaElement).value).toBe(tooManyRows);
  });

  it("rejects files that are not CSV or TSV without changing pasted text", async () => {
    const user = userEvent.setup();
    await openPaste(user);
    const fileInput = screen.getByLabelText("Choose CSV or TSV file");
    const textarea = screen.getByLabelText("Paste spreadsheet rows") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Date,Title,Amount\n2026-08-03,Coffee,45000" } });
    const invalid = new File(["hello"], "notes.txt", { type: "text/plain" });
    const invalidFiles = {
      0: invalid,
      length: 1,
      item: (index: number) => index === 0 ? invalid : null
    };
    fireEvent.change(fileInput, { target: { files: invalidFiles } });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Choose a .csv or .tsv text file."
    );
    expect(textarea.value).toContain("Coffee");
  });

  it("reads CSV text files and recognizes Vietnamese headings", async () => {
    const user = userEvent.setup();
    await openPaste(user);
    const fileInput = screen.getByLabelText("Choose CSV or TSV file");

    const csv = new File(
      ["Ngày giao dịch,Nội dung,Số tiền\n2026-08-03,Cà phê,45000"],
      "giao-dich.csv",
      { type: "text/csv" }
    );
    await user.upload(fileInput, csv);

    expect(await screen.findByText("1 row detected")).not.toBeNull();
    expect((screen.getByLabelText("Date column") as HTMLSelectElement).value).toBe("0");
    expect((screen.getByLabelText("Title column") as HTMLSelectElement).value).toBe("1");
    expect((screen.getByLabelText("Amount column") as HTMLSelectElement).value).toBe("2");
    expect((screen.getByLabelText("Paste spreadsheet rows") as HTMLTextAreaElement).value).toContain("Cà phê");
  });

  it("pastes clipboard text through the explicit pointer control", async () => {
    const user = userEvent.setup();
    await openPaste(user);
    const readText = vi
      .spyOn(navigator.clipboard, "readText")
      .mockResolvedValue("Date\tTitle\tAmount\n2026-08-03\tCoffee\t45000");

    await user.click(screen.getByRole("button", { name: "Paste from clipboard" }));

    expect(readText).toHaveBeenCalledOnce();
    expect(await screen.findByText("1 row detected")).not.toBeNull();
  });

  it("restores a persisted paste capture without asking the user to paste again", () => {
    render(
      <CaptureWorkspace
        {...props}
        initialDrafts={[persistedDraft()]}
      />
    );

    expect(screen.getByRole("tab", { name: "Paste rows" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("1 persisted row ready for review")).not.toBeNull();
    expect(mocks.savePasteDrafts).not.toHaveBeenCalled();
  });
});

describe("editable transaction draft ledger", () => {
  function renderDrafts(drafts: readonly TransactionDraftView[]) {
    return render(<CaptureWorkspace {...props} initialDrafts={drafts} />);
  }

  it("renders a native desktop ledger and responsive mobile cards from the same drafts", () => {
    renderDrafts([persistedDraft()]);

    const ledger = screen.getByTestId("capture-desktop-ledger");
    expect(ledger.classList.contains("hidden")).toBe(true);
    expect(ledger.classList.contains("lg:block")).toBe(true);
    expect(within(ledger).getByRole("table", { name: "Transaction drafts" })).not.toBeNull();
    expect(ledger.querySelector("tbody tbody")).toBeNull();
    expect((within(ledger).getByRole("textbox", { name: "Row 1 amount" }) as HTMLInputElement).value).toBe("45000");
    expect(within(ledger).getByRole("status", { name: "Needs review" })).not.toBeNull();
    expect(within(ledger).getByText("PASTE")).not.toBeNull();

    const cards = screen.getByTestId("capture-mobile-cards");
    expect(cards.classList.contains("lg:hidden")).toBe(true);
    expect(within(cards).getByText("Cà phê sáng")).not.toBeNull();
    expect(within(cards).getByRole("button", { name: "Edit row 1" }).classList.contains("min-h-11")).toBe(true);
  });

  it("renders the planned EMAIL origin as provenance without exposing email capture", () => {
    renderDrafts([persistedDraft({ origin: "EMAIL" })]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const stamp = within(ledger).getByText("EMAIL").parentElement;

    expect(stamp?.textContent).toContain("Forwarded email candidate");
    expect(screen.queryByRole("button", { name: /connect email/i })).toBeNull();
  });

  it("moves right from a text-cell boundary without trapping ordinary text or select editing", async () => {
    const user = userEvent.setup();
    renderDrafts([persistedDraft({ fromMoneySourceId: "wallet" })]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const amount = within(ledger).getByRole("textbox", { name: "Row 1 amount" }) as HTMLInputElement;
    const source = within(ledger).getByRole("combobox", { name: "Row 1 source" });

    amount.focus();
    amount.setSelectionRange(2, 2);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(amount);

    amount.setSelectionRange(1, 3);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(amount);

    amount.setSelectionRange(amount.value.length, amount.value.length);
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(document.activeElement).toBe(amount);

    amount.setSelectionRange(amount.value.length, amount.value.length);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(source);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(source);
  });

  it("moves vertically between text cells in the same ledger column", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft(),
      persistedDraft({ id: "draft-2", position: 1, title: "Tea" })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const firstTitle = within(ledger).getByRole("textbox", { name: "Row 1 title" });
    const secondTitle = within(ledger).getByRole("textbox", { name: "Row 2 title" });

    firstTitle.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(secondTitle);

    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(firstTitle);
  });

  it("restores the text-cell snapshot on Escape without saving the cancelled edit", async () => {
    const user = userEvent.setup();
    renderDrafts([persistedDraft({ status: "READY" })]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    const title = within(ledger).getByRole("textbox", {
      name: "Row 1 title"
    });

    title.focus();
    await user.keyboard("{Enter}");
    await user.type(title, " changed");
    expect((title as HTMLInputElement).value).toBe("Cà phê sáng changed");
    await user.keyboard("{Escape}");
    expect((title as HTMLInputElement).value).toBe("Cà phê sáng");
    await user.tab();

    expect(mocks.updateTransactionDraft).not.toHaveBeenCalled();
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Save 1 transaction"
      }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("restores a failed save's pre-session dirty state when a re-edit is cancelled", async () => {
    const user = userEvent.setup();
    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: false,
      error: "Enter valid draft data."
    });
    renderDrafts([persistedDraft({ status: "READY" })]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    const title = within(ledger).getByRole("textbox", {
      name: "Row 1 title"
    }) as HTMLInputElement;

    await user.clear(title);
    await user.type(title, "Failed local title");
    await user.tab();
    expect(
      await screen.findByText("Row 1 was not saved: Enter valid draft data.")
    ).not.toBeNull();

    title.focus();
    await user.keyboard("{Enter}");
    await user.type(title, " re-edit");
    await user.keyboard("{Escape}");
    expect(title.value).toBe("Failed local title");
    await user.tab();

    expect(mocks.updateTransactionDraft).toHaveBeenCalledOnce();
    expect(
      screen.getByText("1 selected row has unsaved changes.")
    ).not.toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Save selected transactions"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(mocks.importTransactionDrafts).not.toHaveBeenCalled();
  });

  it("starts a fresh save session when typing again before the cancelled blur", async () => {
    const user = userEvent.setup();
    renderDrafts([persistedDraft({ status: "READY" })]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const title = within(ledger).getByRole("textbox", {
      name: "Row 1 title"
    }) as HTMLInputElement;

    title.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" changed");
    await user.keyboard("{Escape}");
    expect(title.value).toBe("Cà phê sáng");

    await user.keyboard(" fresh");
    expect(title.value).toBe("Cà phê sáng fresh");
    await user.tab();

    await waitFor(() =>
      expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-1", {
        title: "Cà phê sáng fresh"
      })
    );
  });

  it("keeps arrow keys inside an active Enter edit and saves on blur", async () => {
    const user = userEvent.setup();
    renderDrafts([persistedDraft()]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const title = within(ledger).getByRole("textbox", {
      name: "Row 1 title"
    }) as HTMLInputElement;

    title.focus();
    title.setSelectionRange(title.value.length, title.value.length);
    await user.keyboard("{Enter}");
    await user.keyboard("!");
    title.setSelectionRange(title.value.length, title.value.length);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(title);

    await user.tab();
    await waitFor(() =>
      expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-1", {
        title: "Cà phê sáng!"
      })
    );
  });

  it("retains fields that remain compatible during a type transition", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({
        fromMoneySourceId: "wallet",
        qualityRating: QualityRating.A,
        countTowardFeeWaiver: true
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");

    await user.selectOptions(
      within(ledger).getByRole("combobox", { name: "Row 1 type" }),
      TransactionType.TRANSFER
    );

    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({
        type: TransactionType.TRANSFER,
        qualityRating: null,
        countTowardFeeWaiver: false
      })
    );
    expect(mocks.updateTransactionDraft.mock.calls[0][1]).not.toHaveProperty(
      "fromMoneySourceId"
    );
  });

  it("does not expose an invalid blank type choice after a type is set", () => {
    renderDrafts([persistedDraft({ type: TransactionType.EXPENSE })]);
    const type = within(screen.getByTestId("capture-desktop-ledger")).getByRole(
      "combobox",
      { name: "Row 1 type" }
    );

    expect(within(type).queryByRole("option", { name: "Choose type" })).toBeNull();
  });

  it("opens an accessible type-specific inspector and clears incompatible fields on type change", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({
        fromMoneySourceId: "card",
        qualityRating: QualityRating.B,
        countTowardFeeWaiver: true
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");

    await user.click(within(ledger).getByRole("button", { name: "Edit details for row 1" }));
    const inspector = within(ledger).getByRole("region", { name: "Details for row 1" });
    expect(within(inspector).getByRole("combobox", { name: "Row 1 project" })).not.toBeNull();
    expect(within(inspector).getByRole("textbox", { name: "Row 1 description" })).not.toBeNull();
    expect(within(inspector).getByRole("checkbox", { name: "Row 1 count toward fee waiver" })).not.toBeNull();

    await user.selectOptions(
      within(ledger).getByRole("combobox", { name: "Row 1 type" }),
      TransactionType.ADJUSTMENT
    );

    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({
        type: TransactionType.ADJUSTMENT,
        fromMoneySourceId: null,
        toMoneySourceId: null,
        qualityRating: null,
        relatedTransactionId: null,
        countTowardFeeWaiver: false
      })
    );
    expect(
      within(ledger).getByRole("combobox", { name: "Row 1 adjusted source" })
    ).not.toBeNull();
    expect(
      within(ledger).getByRole("combobox", { name: "Row 1 adjustment direction" })
    ).not.toBeNull();
  });

  it("offers fee-waiver tracking only for card expenses and clears it when the source stops applying", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({
        fromMoneySourceId: "wallet",
        countTowardFeeWaiver: false
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 1" })
    );
    const inspector = within(ledger).getByRole("region", {
      name: "Details for row 1"
    });
    const source = within(ledger).getByRole("combobox", {
      name: "Row 1 source"
    });

    expect(
      within(inspector).queryByRole("checkbox", {
        name: "Row 1 count toward fee waiver"
      })
    ).toBeNull();

    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: true,
      draft: persistedDraft({
        fromMoneySourceId: "card",
        countTowardFeeWaiver: true,
        countTowardFeeWaiverTouched: false
      })
    });
    await user.selectOptions(source, "card");
    const feeWaiver = within(inspector).getByRole("checkbox", {
      name: "Row 1 count toward fee waiver"
    });
    expect((feeWaiver as HTMLInputElement).checked).toBe(true);
    await user.click(feeWaiver);
    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-1", {
      countTowardFeeWaiver: false,
      countTowardFeeWaiverTouched: true
    });

    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: true,
      draft: persistedDraft({
        fromMoneySourceId: "bank",
        countTowardFeeWaiver: false,
        countTowardFeeWaiverTouched: true
      })
    });
    await user.selectOptions(source, "bank");
    expect(
      within(inspector).queryByRole("checkbox", {
        name: "Row 1 count toward fee waiver"
      })
    ).toBeNull();
    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-1", {
      fromMoneySourceId: "bank"
    });
  });

  it("applies an owned category quality default until the user explicitly clears it", async () => {
    const user = userEvent.setup();
    const initial = persistedDraft({
      fromMoneySourceId: "wallet",
      categoryId: null,
      qualityRating: null,
      qualityRatingTouched: false,
      status: "READY"
    });
    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: true,
      draft: {
        ...initial,
        categoryId: "food",
        qualityRating: QualityRating.A
      }
    });
    renderDrafts([initial]);
    const ledger = screen.getByTestId("capture-desktop-ledger");

    await user.selectOptions(
      within(ledger).getByRole("combobox", { name: "Row 1 category" }),
      "food"
    );
    expect(
      (
        within(ledger).getByRole("combobox", {
          name: "Row 1 quality"
        }) as HTMLSelectElement
      ).value
    ).toBe(QualityRating.A);
    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-1", {
      categoryId: "food"
    });

    await user.selectOptions(
      within(ledger).getByRole("combobox", { name: "Row 1 quality" }),
      ""
    );
    expect(mocks.updateTransactionDraft).toHaveBeenLastCalledWith("draft-1", {
      qualityRating: null,
      qualityRatingTouched: true
    });
  });

  it("keeps a duplicate warning visible as acknowledged and patches only its acknowledgement", async () => {
    const user = userEvent.setup();
    const duplicate = persistedDraft({
      possibleDuplicate: true,
      issues: [
        { field: "form", message: "Confirm this possible duplicate before importing." }
      ]
    });
    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: true,
      draft: {
        ...duplicate,
        duplicateConfirmed: true,
        status: "READY",
        issues: []
      }
    });
    renderDrafts([duplicate]);
    const ledger = screen.getByTestId("capture-desktop-ledger");

    await user.click(within(ledger).getByRole("button", { name: "Edit details for row 1" }));
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Keep row 1 as a separate transaction" })
    );

    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-1", {
      duplicateConfirmed: true
    });
    expect(
      await within(ledger).findByText("Possible duplicate · acknowledged")
    ).not.toBeNull();
  });

  it("focuses the inspector fallback for form and non-rendered field findings", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({
        type: TransactionType.INCOME,
        toMoneySourceId: "wallet",
        issues: [
          { field: "form", message: "Review this row." },
          {
            field: "fromMoneySourceId",
            message: "Income cannot have a from money source."
          }
        ]
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 1" })
    );
    const inspector = within(ledger).getByRole("region", {
      name: "Details for row 1"
    });

    await user.click(within(inspector).getByRole("button", { name: "Review this row." }));
    expect(document.activeElement).toBe(inspector);
    await user.click(
      within(inspector).getByRole("button", {
        name: "Income cannot have a from money source."
      })
    );
    expect(document.activeElement).toBe(inspector);
  });

  it("preserves exact money text, saves on blur, and replaces findings with the authoritative server draft", async () => {
    const user = userEvent.setup();
    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: true,
      draft: persistedDraft({
        amountText: "90071992547409.99",
        fromMoneySourceId: "wallet",
        status: "READY",
        issues: []
      })
    });
    renderDrafts([
      persistedDraft({
        issues: [{ field: "fromMoneySourceId", message: "Choose a source." }]
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const amount = within(ledger).getByRole("textbox", { name: "Row 1 amount" });

    await user.clear(amount);
    await user.type(amount, "90071992547409.99");
    await user.tab();

    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-1", {
      amountText: "90071992547409.99"
    });
    expect(await screen.findByText("Row 1 is ready.")).not.toBeNull();
    expect(within(ledger).getByRole("status", { name: "Ready" })).not.toBeNull();
  });

  it("keeps local input and announces a server patch failure", async () => {
    const user = userEvent.setup();
    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: false,
      error: "Enter valid draft data."
    });
    renderDrafts([persistedDraft()]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const title = within(ledger).getByRole("textbox", { name: "Row 1 title" });

    await user.clear(title);
    await user.type(title, "Cà phê với bạn");
    await user.tab();

    expect(await screen.findByText("Row 1 was not saved: Enter valid draft data.")).not.toBeNull();
    expect((title as HTMLInputElement).value).toBe("Cà phê với bạn");
  });

  it("fills an explicitly selected field down selected rows sequentially and reports partial failures", async () => {
    const user = userEvent.setup();
    let activeCalls = 0;
    let peakCalls = 0;
    mocks.updateTransactionDraft.mockImplementation(async (id: string, patch: Partial<TransactionDraftView>) => {
      activeCalls += 1;
      peakCalls = Math.max(peakCalls, activeCalls);
      await Promise.resolve();
      activeCalls -= 1;
      if (id === "draft-3") throw new Error("network unavailable");
      return { ok: true, draft: persistedDraft({ id, ...patch }) };
    });
    renderDrafts([
      persistedDraft({ id: "draft-1", position: 0, categoryId: "food" }),
      persistedDraft({ id: "draft-2", position: 1, title: "Bánh mì", categoryId: null }),
      persistedDraft({ id: "draft-3", position: 2, title: "Trà đá", categoryId: null })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");

    for (const row of [1, 2, 3]) {
      await user.click(within(ledger).getByRole("checkbox", { name: `Select row ${row}` }));
    }
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field to fill down" }),
      "categoryId"
    );
    await user.click(screen.getByRole("button", { name: "Fill selected rows" }));

    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(2));
    expect(mocks.updateTransactionDraft.mock.calls).toEqual([
      ["draft-2", { categoryId: "food" }],
      ["draft-3", { categoryId: "food" }]
    ]);
    expect(peakCalls).toBe(1);
    expect(await screen.findByText("Updated 1 of 2 rows. 1 row was not saved.")).not.toBeNull();
  });

  it("fills explicit quality with touched provenance and restores a category default after failure", async () => {
    const user = userEvent.setup();
    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: false,
      error: "Network unavailable."
    });
    renderDrafts([
      persistedDraft({
        id: "draft-1",
        position: 0,
        categoryId: "salary",
        qualityRating: QualityRating.C,
        qualityRatingTouched: true
      }),
      persistedDraft({
        id: "draft-2",
        position: 1,
        categoryId: "food",
        qualityRating: QualityRating.A,
        qualityRatingTouched: false
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 2" })
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field to fill down" }),
      "qualityRating"
    );
    await user.click(
      screen.getByRole("button", { name: "Fill selected rows" })
    );

    await waitFor(() =>
      expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-2", {
        qualityRating: QualityRating.C,
        qualityRatingTouched: true
      })
    );
    expect(
      await screen.findByText("Updated 0 of 1 rows. 1 row was not saved.")
    ).not.toBeNull();
    expect(
      (within(ledger).getByRole("combobox", {
        name: "Row 2 quality"
      }) as HTMLSelectElement).value
    ).toBe(QualityRating.A);
  });

  it("blocks import while a selected fill-down operation is queued", async () => {
    const user = userEvent.setup();
    let finishFill: (() => void) | undefined;
    mocks.updateTransactionDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFill = () =>
            resolve({
              ok: true,
              draft: persistedDraft({
                id: "draft-2",
                position: 1,
                status: "READY",
                categoryId: "food"
              })
            });
        })
    );
    renderDrafts([
      persistedDraft({
        id: "draft-1",
        position: 0,
        status: "READY",
        categoryId: "food"
      }),
      persistedDraft({
        id: "draft-2",
        position: 1,
        status: "READY",
        categoryId: null
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    for (const row of [1, 2]) {
      await user.click(
        within(ledger).getByRole("checkbox", { name: `Select row ${row}` })
      );
    }
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field to fill down" }),
      "categoryId"
    );
    await user.click(screen.getByRole("button", { name: "Fill selected rows" }));

    expect(
      await screen.findByText("Wait for selected bulk changes to finish saving.")
    ).not.toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Save selected transactions"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(mocks.importTransactionDrafts).not.toHaveBeenCalled();

    finishFill?.();
    expect(
      await screen.findByRole("button", { name: "Save 2 transactions" })
    ).not.toBeNull();
  });

  it("refuses an unsafe source fill across mixed transaction flows", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({
        id: "draft-1",
        type: TransactionType.EXPENSE,
        fromMoneySourceId: "wallet"
      }),
      persistedDraft({
        id: "draft-2",
        position: 1,
        type: TransactionType.INCOME,
        toMoneySourceId: "bank"
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 2" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field to fill down" }),
      "source"
    );
    await user.click(screen.getByRole("button", { name: "Fill selected rows" }));

    expect(
      await screen.findByText(
        "Source fill needs selected rows with the same transaction flow."
      )
    ).not.toBeNull();
    expect(mocks.updateTransactionDraft).not.toHaveBeenCalled();
  });

  it("lets owned defaults clear untouched fee-waiver tracking after a card-to-bank fill", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({
        id: "draft-1",
        fromMoneySourceId: "wallet",
        countTowardFeeWaiver: false
      }),
      persistedDraft({
        id: "draft-2",
        position: 1,
        fromMoneySourceId: "card",
        countTowardFeeWaiver: true
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 1" })
    );
    await user.click(
      within(ledger).getByRole("checkbox", { name: "Select row 2" })
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field to fill down" }),
      "source"
    );
    await user.click(
      screen.getByRole("button", { name: "Fill selected rows" })
    );

    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledOnce());
    expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-2", {
      fromMoneySourceId: "wallet"
    });
  });

  it("applies a card default during fill while preserving an explicit manual false", async () => {
    const user = userEvent.setup();
    mocks.updateTransactionDraft
      .mockResolvedValueOnce({
        ok: true,
        draft: persistedDraft({
          id: "draft-2",
          position: 1,
          fromMoneySourceId: "card",
          countTowardFeeWaiver: true,
          countTowardFeeWaiverTouched: false
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        draft: persistedDraft({
          id: "draft-3",
          position: 2,
          fromMoneySourceId: "card",
          countTowardFeeWaiver: false,
          countTowardFeeWaiverTouched: true
        })
      });
    renderDrafts([
      persistedDraft({
        id: "draft-1",
        fromMoneySourceId: "card",
        countTowardFeeWaiver: true
      }),
      persistedDraft({
        id: "draft-2",
        position: 1,
        fromMoneySourceId: "wallet",
        countTowardFeeWaiver: false,
        countTowardFeeWaiverTouched: false
      }),
      persistedDraft({
        id: "draft-3",
        position: 2,
        fromMoneySourceId: "bank",
        countTowardFeeWaiver: false,
        countTowardFeeWaiverTouched: true
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    for (const row of [1, 2, 3]) {
      await user.click(
        within(ledger).getByRole("checkbox", { name: `Select row ${row}` })
      );
    }
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field to fill down" }),
      "source"
    );
    await user.click(screen.getByRole("button", { name: "Fill selected rows" }));

    await waitFor(() =>
      expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(2)
    );
    expect(mocks.updateTransactionDraft.mock.calls).toEqual([
      ["draft-2", { fromMoneySourceId: "card" }],
      ["draft-3", { fromMoneySourceId: "card" }]
    ]);
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 2" })
    );
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 3" })
    );
    expect(
      (within(ledger).getByRole("checkbox", {
        name: "Row 2 count toward fee waiver"
      }) as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (within(ledger).getByRole("checkbox", {
        name: "Row 3 count toward fee waiver"
      }) as HTMLInputElement).checked
    ).toBe(false);
  });

  it("does not overwrite a field touched after fill-down begins", async () => {
    const user = userEvent.setup();
    let releaseFirst: (() => void) | undefined;
    mocks.updateTransactionDraft
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          releaseFirst = () => resolve({
            ok: true,
            draft: persistedDraft({ id: "draft-2", position: 1, categoryId: "food" })
          });
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        draft: persistedDraft({ id: "draft-3", position: 2, categoryId: "food" })
      });
    renderDrafts([
      persistedDraft({ id: "draft-1", position: 0, categoryId: "food" }),
      persistedDraft({ id: "draft-2", position: 1, title: "Bánh mì", categoryId: null }),
      persistedDraft({ id: "draft-3", position: 2, title: "Trà đá", categoryId: null })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    for (const row of [1, 2, 3]) {
      await user.click(within(ledger).getByRole("checkbox", { name: `Select row ${row}` }));
    }
    await user.selectOptions(screen.getByRole("combobox", { name: "Field to fill down" }), "categoryId");
    await user.click(screen.getByRole("button", { name: "Fill selected rows" }));
    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(1));

    await user.selectOptions(
      within(ledger).getByRole("combobox", { name: "Row 3 category" }),
      "salary"
    );
    releaseFirst?.();

    await waitFor(() => expect(screen.getByText("Updated 1 row. Skipped 1 row changed during fill.")).not.toBeNull());
    expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(2);
    expect(mocks.updateTransactionDraft).not.toHaveBeenCalledWith("draft-3", { categoryId: "food" });
  });

  it("rolls back unchanged fields after a multi-field fill failure while preserving a later type edit", async () => {
    const user = userEvent.setup();
    let rejectFill: (() => void) | undefined;
    mocks.updateTransactionDraft.mockImplementationOnce(
      () => new Promise((resolve) => {
        rejectFill = () => resolve({ ok: false, error: "Network unavailable." });
      })
    );
    renderDrafts([
      persistedDraft({
        id: "draft-1",
        type: TransactionType.EXPENSE,
        fromMoneySourceId: "wallet"
      }),
      persistedDraft({
        id: "draft-2",
        position: 1,
        type: TransactionType.TRANSFER,
        fromMoneySourceId: "wallet",
        toMoneySourceId: "bank"
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 2" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field to fill down" }),
      "type"
    );
    await user.click(screen.getByRole("button", { name: "Fill selected rows" }));
    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(1));

    await user.selectOptions(
      within(ledger).getByRole("combobox", { name: "Row 2 type" }),
      TransactionType.INCOME
    );
    rejectFill?.();

    await waitFor(() =>
      expect(
        (within(ledger).getByRole("combobox", { name: "Row 2 type" }) as HTMLSelectElement).value
      ).toBe(TransactionType.INCOME)
    );
    expect(
      (within(ledger).getByRole("combobox", { name: "Row 2 source" }) as HTMLSelectElement).value
    ).toBe("bank");
  });

  it("keeps a newer pasted cell value when an older ordinary save resolves last", async () => {
    const user = userEvent.setup();
    let releaseOlder: (() => void) | undefined;
    mocks.updateTransactionDraft
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          releaseOlder = () => resolve({
            ok: true,
            draft: persistedDraft({ amountText: "50000" })
          });
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        draft: persistedDraft({ amountText: "90071992547409.99", status: "READY" })
      });
    renderDrafts([persistedDraft()]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const amount = within(ledger).getByRole("textbox", { name: "Row 1 amount" });
    await user.clear(amount);
    await user.type(amount, "50000");
    await user.tab();
    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(1));
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));

    fireEvent.paste(amount, {
      clipboardData: { getData: () => "90071992547409.99\n" }
    });
    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(2));
    releaseOlder?.();

    await waitFor(() =>
      expect((amount as HTMLInputElement).value).toBe("90071992547409.99")
    );
  });

  it("merges sibling duplicate findings when an edit creates and removes a duplicate pair", async () => {
    const user = userEvent.setup();
    const first = persistedDraft({
      id: "draft-1",
      status: "READY",
      title: "Coffee"
    });
    const second = persistedDraft({
      id: "draft-2",
      position: 1,
      status: "READY",
      title: "Tea"
    });
    mocks.updateTransactionDraft
      .mockResolvedValueOnce({
        ok: true,
        draft: { ...first, title: "Tea" },
        drafts: [
          { ...first, title: "Tea" },
          {
            ...second,
            status: "NEEDS_REVIEW",
            possibleDuplicate: true,
            issues: [
              {
                field: "form",
                message: "Confirm this possible duplicate before importing."
              }
            ]
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        draft: first,
        drafts: [first, second]
      });
    renderDrafts([first, second]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const title = within(ledger).getByRole("textbox", { name: "Row 1 title" });

    fireEvent.change(title, { target: { value: "Tea" } });
    fireEvent.blur(title);

    await waitFor(() =>
      expect(
        within(ledger).getAllByRole("status")[1].getAttribute("aria-label")
      ).toBe("Needs review, 1 issue")
    );
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 2" })
    );
    expect(
      within(ledger).getByRole("button", {
        name: "Confirm this possible duplicate before importing."
      })
    ).not.toBeNull();
    expect(within(ledger).getByText("Possible duplicate")).not.toBeNull();

    const currentTitle = within(ledger).getByRole("textbox", {
      name: "Row 1 title"
    });
    fireEvent.change(currentTitle, { target: { value: "Coffee" } });
    fireEvent.blur(currentTitle);

    await waitFor(() =>
      expect(
        within(ledger).getAllByRole("status")[1].getAttribute("aria-label")
      ).toBe("Ready")
    );
    expect(within(ledger).queryByText("Possible duplicate")).toBeNull();
    expect(
      within(ledger).queryByRole("button", {
        name: "Confirm this possible duplicate before importing."
      })
    ).toBeNull();
  });

  it("ignores older authoritative metadata after a newer response resolves first", async () => {
    const user = userEvent.setup();
    let releaseOlder: (() => void) | undefined;
    const initial = persistedDraft({
      status: "NEEDS_REVIEW",
      confidence: 40,
      issues: [{ field: "fromMoneySourceId", message: "Choose a source." }]
    });
    const newer = persistedDraft({
      amountText: "50000",
      title: "Newest title",
      fromMoneySourceId: "wallet",
      status: "READY",
      confidence: 95,
      issues: [],
      possibleDuplicate: false
    });
    const older = persistedDraft({
      amountText: "50000",
      title: "Cà phê sáng",
      status: "NEEDS_REVIEW",
      confidence: 5,
      issues: [
        {
          field: "form",
          message: "Confirm this possible duplicate before importing."
        }
      ],
      possibleDuplicate: true
    });
    mocks.updateTransactionDraft
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOlder = () =>
              resolve({ ok: true, draft: older, drafts: [older] });
          })
      )
      .mockResolvedValueOnce({ ok: true, draft: newer, drafts: [newer] });
    renderDrafts([initial]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const amount = within(ledger).getByRole("textbox", { name: "Row 1 amount" });
    const source = within(ledger).getByRole("combobox", { name: "Row 1 source" });

    fireEvent.change(amount, { target: { value: "50000" } });
    fireEvent.blur(amount);
    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(1));
    await user.selectOptions(source, "wallet");
    await waitFor(() =>
      expect(within(ledger).getByRole("status", { name: "Ready" })).not.toBeNull()
    );

    await act(async () => releaseOlder?.());

    await waitFor(() =>
      expect(
        (within(ledger).getByRole("combobox", {
          name: "Row 1 source"
        }) as HTMLSelectElement).value
      ).toBe("wallet")
    );
    expect(within(ledger).getByRole("status", { name: "Ready" })).not.toBeNull();
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 1" })
    );
    expect(within(ledger).queryByText("Possible duplicate")).toBeNull();
    expect(
      within(ledger).queryByRole("button", {
        name: "Confirm this possible duplicate before importing."
      })
    ).toBeNull();
  });

  it("preserves sibling metadata when that sibling fields advance after a request", async () => {
    const user = userEvent.setup();
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const first = persistedDraft({ id: "draft-1", status: "READY" });
    const sibling = persistedDraft({
      id: "draft-2",
      position: 1,
      title: "Tea",
      status: "NEEDS_REVIEW",
      confidence: 25,
      possibleDuplicate: true,
      issues: [
        {
          field: "form",
          message: "Confirm this possible duplicate before importing."
        }
      ]
    });
    const staleSibling = {
      ...sibling,
      status: "READY" as const,
      confidence: 90,
      possibleDuplicate: false,
      issues: []
    };
    mocks.updateTransactionDraft
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () =>
              resolve({
                ok: true,
                draft: { ...first, title: "Coffee edited" },
                drafts: [{ ...first, title: "Coffee edited" }, staleSibling]
              });
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSecond = () =>
              resolve({
                ok: true,
                draft: { ...sibling, title: "Tea edited" },
                drafts: [first, { ...sibling, title: "Tea edited" }]
              });
          })
      );
    renderDrafts([first, sibling]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const firstTitle = within(ledger).getByRole("textbox", { name: "Row 1 title" });
    const siblingTitle = within(ledger).getByRole("textbox", { name: "Row 2 title" });

    fireEvent.change(firstTitle, { target: { value: "Coffee edited" } });
    fireEvent.blur(firstTitle);
    fireEvent.change(siblingTitle, { target: { value: "Tea edited" } });
    fireEvent.blur(siblingTitle);
    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(2));

    await act(async () => releaseFirst?.());

    await waitFor(() =>
      expect((siblingTitle as HTMLInputElement).value).toBe("Tea edited")
    );
    expect(
      within(ledger).getAllByRole("status")[1].getAttribute("aria-label")
    ).toBe("Needs review, 1 issue");
    await user.click(
      within(ledger).getByRole("button", { name: "Edit details for row 2" })
    );
    expect(within(ledger).getByText("Possible duplicate")).not.toBeNull();
    expect(
      within(ledger).getByRole("button", {
        name: "Confirm this possible duplicate before importing."
      })
    ).not.toBeNull();

    await act(async () => releaseSecond?.());
  });

  it("keeps fill-down available as a 44px pointer and keyboard control beside mobile cards", () => {
    renderDrafts([persistedDraft(), persistedDraft({ id: "draft-2", position: 1 })]);

    const toolbar = screen.getByRole("group", { name: "Fill selected draft rows" });
    expect(toolbar.classList.contains("hidden")).toBe(false);
    expect(within(toolbar).getByRole("combobox", { name: "Field to fill down" }).classList.contains("min-h-11")).toBe(true);
    expect(within(toolbar).getByRole("button", { name: "Fill selected rows" }).classList.contains("min-h-11")).toBe(true);
  });

  it("defaults only a blank type from the prior row and preserves a later explicit edit", async () => {
    const user = userEvent.setup();
    let releaseDefault: (() => void) | undefined;
    mocks.updateTransactionDraft.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseDefault = () => resolve({
          ok: true,
          draft: persistedDraft({
            id: "draft-2",
            position: 1,
            type: TransactionType.INCOME,
            toMoneySourceId: "wallet"
          })
        });
      })
    );
    renderDrafts([
      persistedDraft({ id: "draft-1", type: TransactionType.INCOME, toMoneySourceId: "wallet" }),
      persistedDraft({ id: "draft-2", position: 1, type: null, fromMoneySourceId: null })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const secondType = within(ledger).getByRole("combobox", { name: "Row 2 type" });

    await waitFor(() => expect((secondType as HTMLSelectElement).value).toBe(TransactionType.INCOME));
    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledWith("draft-2", {
      type: TransactionType.INCOME
    }));
    await user.selectOptions(secondType, TransactionType.EXPENSE);
    releaseDefault?.();

    await waitFor(() => expect((secondType as HTMLSelectElement).value).toBe(TransactionType.EXPENSE));
  });

  it("rolls back a rejected prior-row default and does not retry it", async () => {
    mocks.updateTransactionDraft.mockResolvedValueOnce({
      ok: false,
      error: "Enter valid draft data."
    });
    renderDrafts([
      persistedDraft({ id: "draft-1", type: TransactionType.INCOME }),
      persistedDraft({ id: "draft-2", position: 1, type: null })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    const secondType = within(ledger).getByRole("combobox", { name: "Row 2 type" });

    expect(
      await screen.findByText(
        "Applied 0 of 1 row defaults. 1 default was not saved."
      )
    ).not.toBeNull();
    expect((secondType as HTMLSelectElement).value).toBe("");
    expect(mocks.updateTransactionDraft).toHaveBeenCalledOnce();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updateTransactionDraft).toHaveBeenCalledOnce();
  });

  it.each(["IMPORTING", "IMPORTED", "DISMISSED"] as const)(
    "does not default, select, or edit a %s draft",
    async (status) => {
    renderDrafts([
      persistedDraft({ id: "draft-1", type: TransactionType.INCOME }),
      persistedDraft({
        id: "terminal",
        position: 1,
        status,
        type: null,
        currency: null,
        title: null,
        amountText: null,
        importedTransactionId:
          status === "IMPORTED" ? "transaction-1" : null
      })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");

    expect(
      (within(ledger).getByRole("checkbox", { name: "Select row 2" }) as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      (within(ledger).getByRole("combobox", { name: "Row 2 type" }) as HTMLSelectElement).disabled
    ).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.updateTransactionDraft).not.toHaveBeenCalled();
    }
  );

  it("pastes one exact-text column down selected amount cells through the sequential queue", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({ id: "draft-1", position: 0 }),
      persistedDraft({ id: "draft-2", position: 1, title: "Bánh mì" })
    ]);
    const ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 2" }));
    const amount = within(ledger).getByRole("textbox", { name: "Row 1 amount" });

    fireEvent.paste(amount, {
      clipboardData: { getData: () => "90071992547409.99\n125000.50" }
    });

    await waitFor(() => expect(mocks.updateTransactionDraft).toHaveBeenCalledTimes(2));
    expect(mocks.updateTransactionDraft.mock.calls).toEqual([
      ["draft-1", { amountText: "90071992547409.99" }],
      ["draft-2", { amountText: "125000.50" }]
    ]);
    expect(await screen.findByText("Updated 2 rows from pasted cells.")).not.toBeNull();
  });

  it("shows refund and adjustment inspector fields in the same logical order on mobile", async () => {
    const user = userEvent.setup();
    renderDrafts([
      persistedDraft({
        id: "refund",
        type: TransactionType.REFUND,
        toMoneySourceId: "wallet"
      }),
      persistedDraft({
        id: "adjustment",
        position: 1,
        type: TransactionType.ADJUSTMENT,
        adjustedMoneySourceId: "bank",
        adjustmentDirection: AdjustmentDirection.DECREASE,
        adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT
      })
    ]);
    const cards = screen.getByTestId("capture-mobile-cards");
    await user.click(within(cards).getByRole("button", { name: "Edit row 1" }));
    const destination = within(cards).getByRole("combobox", {
      name: "Row 1 destination"
    });
    expect(destination.classList.contains("min-h-11")).toBe(true);
    expect(destination.classList.contains("md:min-h-11")).toBe(true);
    expect(within(cards).getByRole("combobox", { name: "Row 1 related expense" })).not.toBeNull();

    await user.click(within(cards).getByRole("button", { name: "Edit row 2" }));
    expect(within(cards).getByRole("combobox", { name: "Row 2 adjusted source" })).not.toBeNull();
    expect(within(cards).getByRole("combobox", { name: "Row 2 adjustment target" })).not.toBeNull();
  });

  it("clears selection when reviewed paste rows replace the capture result", async () => {
    const user = userEvent.setup();
    mocks.savePasteDrafts.mockResolvedValueOnce({
      ok: true,
      drafts: [persistedDraft({ id: "replacement", title: "Replacement" })]
    });
    renderDrafts([persistedDraft()]);
    let ledger = screen.getByTestId("capture-desktop-ledger");
    await user.click(within(ledger).getByRole("checkbox", { name: "Select row 1" }));
    await pasteRows(user, "Date,Title,Amount\n2026-08-04,Replacement,60000");
    await user.click(await screen.findByRole("button", { name: "Review rows" }));

    expect((await screen.findAllByText("Replacement")).length).toBeGreaterThan(0);
    ledger = screen.getByTestId("capture-desktop-ledger");
    expect(
      (within(ledger).getByRole("checkbox", { name: "Select row 1" }) as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Fill selected rows" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
