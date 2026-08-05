// @vitest-environment jsdom

import { TransactionType } from "@prisma/client";
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
  savePasteDrafts: vi.fn()
}));

vi.mock("@/lib/actions/transaction-drafts", () => ({
  savePasteDrafts: mocks.savePasteDrafts
}));

const captureKey = "550e8400-e29b-41d4-a716-446655440000";

const props: CaptureWorkspaceProps = {
  initialCaptureKey: captureKey,
  initialDrafts: [],
  options: {
    categories: [{ id: "food", name: "Ăn uống" }],
    moneySources: [{ id: "wallet", name: "Ví tiền" }],
    projects: [{ id: "trip", name: "Du lịch" }],
    expenses: []
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
    recurringPaymentId: null,
    isInstallmentRelated: false,
    duplicateConfirmed: false,
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
});

afterEach(cleanup);

describe("spreadsheet transaction capture", () => {
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
          title: "Coffee",
          transactionDateText: "2026-08-03"
        })
      ]
    });
    expect(window.location.search).toBe(`?capture=${captureKey}`);
    expect(window.history.state).toEqual(existingHistoryState);
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
