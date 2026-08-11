// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ReceiptUploadLoading from "@/app/(protected)/receipt-upload/loading";
import SettingsLoading from "@/app/(protected)/settings/loading";
import TransactionCaptureLoading from "@/app/(protected)/transactions/capture/loading";
import InboundEmailLoading from "@/app/(protected)/transactions/capture/email/loading";
import TransactionsLoading from "@/app/(protected)/transactions/loading";

afterEach(cleanup);

describe("remaining protected loading states", () => {
  it("renders the Settings skeleton without a spinner", () => {
    const { container } = render(<SettingsLoading />);

    expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(
      Array.from(container.querySelectorAll(".animate-pulse")).every((element) =>
        element.classList.contains("motion-reduce:animate-none")
      )
    ).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders the Receipt Upload skeleton without a spinner", () => {
    const { container } = render(<ReceiptUploadLoading />);

    expect(
      screen.getByRole("heading", { name: "Receipt Upload" })
    ).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(
      Array.from(container.querySelectorAll(".animate-pulse")).every((element) =>
        element.classList.contains("motion-reduce:animate-none")
      )
    ).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders the transaction list skeleton with filters and ledger rows", () => {
    const { container } = render(<TransactionsLoading />);

    expect(screen.getByRole("heading", { name: "Transactions" })).not.toBeNull();
    expect(screen.getByLabelText("Transaction filters loading")).not.toBeNull();
    expect(screen.getByLabelText("Transaction ledger loading")).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders capture-specific mode, paste, ledger, and sticky-summary skeletons", () => {
    const { container } = render(<TransactionCaptureLoading />);

    expect(
      screen.getByRole("heading", { name: "Capture transactions" })
    ).not.toBeNull();
    expect(screen.getByLabelText("Capture method loading")).not.toBeNull();
    expect(screen.getByLabelText("Paste rows loading")).not.toBeNull();
    expect(screen.getByLabelText("Review ledger loading")).not.toBeNull();
    expect(screen.getByLabelText("Capture summary loading")).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(
      Array.from(container.querySelectorAll(".animate-pulse")).every((element) =>
        element.classList.contains("motion-reduce:animate-none")
      )
    ).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders a labelled, bounded inbound email setup skeleton", () => {
    const { container } = render(<InboundEmailLoading />);

    expect(screen.getByRole("heading", { name: "Email forwarding" })).not.toBeNull();
    expect(screen.getByLabelText("Email setup loading")).not.toBeNull();
    expect(container.querySelectorAll("section.rounded-xl").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".max-w-5xl")).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(
      Array.from(container.querySelectorAll(".animate-pulse")).every((element) =>
        element.classList.contains("motion-reduce:animate-none")
      )
    ).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
