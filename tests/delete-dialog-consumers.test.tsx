// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TransactionForm,
  type TransactionFormInitialValues
} from "@/components/transaction-form";
import { RenewalDeleteButton } from "@/components/renewal-delete-button";

const consumerMocks = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  deleteRenewal: vi.fn(),
  deleteTransaction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  updateTransaction: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: consumerMocks.push,
    refresh: consumerMocks.refresh
  })
}));

vi.mock("@/lib/actions/transactions", () => ({
  createTransaction: consumerMocks.createTransaction,
  deleteTransaction: consumerMocks.deleteTransaction,
  updateTransaction: consumerMocks.updateTransaction
}));

vi.mock("@/lib/actions/renewals", () => ({
  deleteRenewal: consumerMocks.deleteRenewal
}));

const transactionValues: TransactionFormInitialValues = {
  id: "transaction-1",
  type: TransactionType.EXPENSE,
  amount: "25.00",
  currency: "VND",
  title: "Lunch",
  description: "Team lunch",
  transactionDate: "2026-07-31",
  categoryId: "",
  qualityRating: "A",
  fromMoneySourceId: "bank-1",
  toMoneySourceId: "",
  adjustedMoneySourceId: "",
  adjustmentDirection: AdjustmentDirection.INCREASE,
  adjustmentTarget: AdjustmentTarget.CREDIT_CARD_DEBT,
  projectId: "",
  relatedTransactionId: "",
  countTowardFeeWaiver: false
};

function renderTransaction() {
  return render(
    <TransactionForm
      categories={[]}
      expenseTransactions={[]}
      initialValues={transactionValues}
      moneySources={[
        {
          id: "bank-1",
          name: "Main bank",
          type: MoneySourceType.BANK_ACCOUNT
        }
      ]}
      projects={[]}
    />
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete" }));
  return screen.getByRole("dialog");
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  consumerMocks.createTransaction.mockResolvedValue({ ok: true });
  consumerMocks.deleteRenewal.mockResolvedValue({ ok: true });
  consumerMocks.deleteTransaction.mockResolvedValue({ ok: true });
  consumerMocks.updateTransaction.mockResolvedValue({ ok: true });
});

describe("transaction delete confirmation", () => {
  it("keeps returned delete failures inside the modal and separate from save errors", async () => {
    const user = userEvent.setup();
    consumerMocks.updateTransaction.mockResolvedValueOnce({
      ok: false,
      error: "Unable to save these transaction changes."
    });
    consumerMocks.deleteTransaction.mockResolvedValueOnce({
      ok: false,
      error: "This transaction cannot be deleted yet."
    });
    const { container } = renderTransaction();

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(
      await screen.findByText("Unable to save these transaction changes.")
    ).not.toBeNull();

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "This transaction cannot be deleted yet."
    );
    expect(
      screen.getByText("Unable to save these transaction changes.")
    ).not.toBeNull();
    expect(
      (within(dialog).getByRole("button", {
        name: "Delete"
      }) as HTMLButtonElement).disabled
    ).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const reopenedDialog = await openDialog(user);
    expect(within(reopenedDialog).queryByRole("alert")).toBeNull();
    expect(
      screen.getByText("Unable to save these transaction changes.")
    ).not.toBeNull();
  });

  it("contains thrown failures and permits a successful retry with navigation", async () => {
    const user = userEvent.setup();
    consumerMocks.deleteTransaction
      .mockRejectedValueOnce(new Error("private transaction database detail"))
      .mockResolvedValueOnce({ ok: true });
    renderTransaction();

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(
      "Unable to delete transaction. Please try again."
    );
    expect(alert.textContent).not.toContain("private transaction database detail");

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(consumerMocks.deleteTransaction).toHaveBeenCalledTimes(2);
    expect(consumerMocks.push).toHaveBeenCalledWith("/transactions");
    expect(consumerMocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("renewal delete confirmation", () => {
  it("shows returned failures in the modal and permits a successful retry", async () => {
    const user = userEvent.setup();
    consumerMocks.deleteRenewal
      .mockResolvedValueOnce({
        ok: false,
        error: "This renewal cannot be deleted yet."
      })
      .mockResolvedValueOnce({ ok: true });
    render(<RenewalDeleteButton id="renewal-1" />);

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "This renewal cannot be deleted yet."
    );
    expect(
      (within(dialog).getByRole("button", {
        name: "Delete"
      }) as HTMLButtonElement).disabled
    ).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(consumerMocks.deleteRenewal).toHaveBeenCalledTimes(2);
    expect(consumerMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("contains thrown failures and clears them after cancel and reopen", async () => {
    const user = userEvent.setup();
    consumerMocks.deleteRenewal.mockRejectedValueOnce(
      new Error("private renewal database detail")
    );
    render(<RenewalDeleteButton id="renewal-1" />);

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(
      "Unable to delete renewal. Please try again."
    );
    expect(alert.textContent).not.toContain("private renewal database detail");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const reopenedDialog = await openDialog(user);
    expect(within(reopenedDialog).queryByRole("alert")).toBeNull();
  });

  it("blocks duplicate confirmation while the delete is pending", async () => {
    const user = userEvent.setup();
    let finishDelete:
      | ((result: { ok: true }) => void)
      | undefined;
    consumerMocks.deleteRenewal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDelete = resolve;
        })
    );
    render(<RenewalDeleteButton id="renewal-1" />);

    const dialog = await openDialog(user);
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    await user.dblClick(confirm);

    expect(consumerMocks.deleteRenewal).toHaveBeenCalledTimes(1);
    expect(
      (within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (within(dialog).getByRole("button", {
        name: "Deleting"
      }) as HTMLButtonElement).disabled
    ).toBe(true);

    finishDelete?.({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(consumerMocks.refresh).toHaveBeenCalledTimes(1);
  });
});
