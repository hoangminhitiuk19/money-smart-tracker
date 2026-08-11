// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSetupPanel } from "@/components/inbound-email/EmailSetupPanel";
import type { InboundEmailSetupView } from "@/lib/actions/inbound-email";

const actionMocks = vi.hoisted(() => ({
  create: vi.fn(),
  rotate: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  deletePending: vi.fn(),
  disconnect: vi.fn()
}));

vi.mock("@/lib/actions/inbound-email", () => ({
  createInboundMailbox: actionMocks.create,
  rotateInboundMailbox: actionMocks.rotate,
  enableInboundMailbox: actionMocks.enable,
  disableInboundMailbox: actionMocks.disable,
  deletePendingInboundEmailDrafts: actionMocks.deletePending,
  disconnectInboundMailbox: actionMocks.disconnect
}));

const address = "private-token@example.test";
const captureKey = "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36";

function setupView(
  overrides: Partial<NonNullable<InboundEmailSetupView["mailbox"]>> = {}
): InboundEmailSetupView {
  return {
    configured: true,
    mailbox: {
      address,
      status: "ACTIVE",
      lastDisposition: null,
      lastReceivedAt: null,
      reviewCaptureKey: null,
      ...overrides
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  actionMocks.create.mockResolvedValue({ ok: true, setup: setupView() });
  actionMocks.rotate.mockResolvedValue({ ok: true, setup: setupView() });
  actionMocks.enable.mockResolvedValue({ ok: true, setup: setupView() });
  actionMocks.disable.mockResolvedValue({
    ok: true,
    setup: setupView({ status: "DISABLED" })
  });
  actionMocks.deletePending.mockResolvedValue({
    ok: true,
    deletedCount: 2,
    setup: setupView()
  });
  actionMocks.disconnect.mockResolvedValue({
    ok: true,
    deletedDraftCount: 3,
    disconnected: true
  });
});

afterEach(cleanup);

describe("EmailSetupPanel safety and state", () => {
  it("explains the testing boundary and renders the exact synthetic fixture", () => {
    render(<EmailSetupPanel initialSetup={{ configured: false, mailbox: null }} />);

    expect(screen.getByText(
      "Testing only — use synthetic or redacted information. Money Smart Tracker cannot browse your mailbox; it receives only messages sent to this private address. Resend may retain received email for up to 30 days."
    )).not.toBeNull();
    expect(screen.getByText("MONEY SMART TRACKER TEST", { exact: false }).textContent).toBe(
      "MONEY SMART TRACKER TEST\nAmount: 125000\nCurrency: VND\nDate: 2026-08-10\nMerchant: Demo Cafe"
    );
    expect(screen.getByRole("button", { name: "Copy synthetic test message" })).not.toBeNull();
    expect(screen.getByText("Not configured")).not.toBeNull();
    const addressSection = screen
      .getByRole("heading", { name: "Private test address" })
      .closest("section");
    expect(addressSection?.querySelector('[aria-hidden="true"]')?.textContent).toBe("!");
  });

  it("creates an address and copies it with address-free live confirmation", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<EmailSetupPanel initialSetup={{ configured: true, mailbox: null }} />);

    await user.click(screen.getByRole("button", { name: "Create test address" }));
    expect(await screen.findByText(address)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy test address" }));

    expect(writeText).toHaveBeenCalledWith(address);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Test address copied.");
    expect(status.textContent).not.toContain(address);
    expect(screen.getByRole("button", { name: "Copy test address" }).getAttribute("aria-label")).not.toContain(address);
  });

  it("copies the exact synthetic message", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<EmailSetupPanel initialSetup={setupView()} />);

    await user.click(screen.getByRole("button", { name: "Copy synthetic test message" }));

    expect(writeText).toHaveBeenCalledWith(
      "MONEY SMART TRACKER TEST\nAmount: 125000\nCurrency: VND\nDate: 2026-08-10\nMerchant: Demo Cafe"
    );
  });

  it.each([
    [null, "Waiting"],
    ["TEST_DRAFT_CREATED", "Received"],
    ["DUPLICATE", "Duplicate"],
    ["UNSUPPORTED", "Unsupported"],
    ["OVERSIZED", "Rejected"],
    ["PARSER_ERROR", "Rejected"],
    ["RATE_LIMITED", "Delayed"],
    ["PROVIDER_ERROR", "Delayed"]
  ] as const)("labels %s disposition as %s without relying on color", (lastDisposition, label) => {
    const { container } = render(
      <EmailSetupPanel initialSetup={setupView({ lastDisposition })} />
    );

    const statusHeading = screen.getByRole("heading", { name: label });
    expect(statusHeading).not.toBeNull();
    expect(statusHeading.parentElement?.parentElement?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.textContent).toContain("Active");
  });

  it("labels a disabled mailbox with text and an icon", () => {
    render(<EmailSetupPanel initialSetup={setupView({ status: "DISABLED" })} />);

    const disabled = screen.getByText("Disabled");
    expect(disabled.parentElement?.parentElement?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("links to review using only the safe capture UUID", () => {
    render(
      <EmailSetupPanel
        initialSetup={setupView({ reviewCaptureKey: captureKey })}
      />
    );

    const link = screen.getByRole("link", { name: "Review test draft" });
    expect(link.getAttribute("href")).toBe(`/transactions/capture?capture=${captureKey}`);
    expect(link.getAttribute("href")).not.toContain(address);
  });

  it("does not build a review URL from a non-UUID identifier", () => {
    render(
      <EmailSetupPanel
        initialSetup={setupView({
          reviewCaptureKey: "mailbox-private-id" as typeof captureKey
        })}
      />
    );

    expect(screen.queryByRole("link", { name: "Review test draft" })).toBeNull();
  });
});

describe("EmailSetupPanel confirmations", () => {
  it.each([
    ["Rotate test address", "Rotate the test address?", "The current address will stop accepting messages immediately. Pending test drafts stay available.", "Rotate address"],
    ["Disable email forwarding", "Disable email forwarding?", "New messages will be ignored until email forwarding is enabled again. Pending test drafts stay available.", "Disable forwarding"],
    ["Delete pending test drafts", "Delete pending test drafts?", "All pending email test drafts will be permanently deleted. Your forwarding address stays active.", "Delete pending drafts"],
    ["Disconnect email forwarding", "Disconnect email forwarding?", "The test address will stop working and all pending email test drafts will be permanently deleted.", "Disconnect email"]
  ])("shows the exact effect before %s", async (triggerName, title, description, confirmName) => {
    const user = userEvent.setup();
    render(<EmailSetupPanel initialSetup={setupView()} />);

    await user.click(screen.getByRole("button", { name: triggerName }));
    const dialog = screen.getByRole("dialog", { name: title });

    expect(within(dialog).getByText(description)).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: confirmName })).not.toBeNull();
  });

  it("confirms enabling before accepting new test messages", async () => {
    const user = userEvent.setup();
    render(<EmailSetupPanel initialSetup={setupView({ status: "DISABLED" })} />);

    await user.click(screen.getByRole("button", { name: "Enable email forwarding" }));
    expect(screen.getByRole("dialog", { name: "Enable email forwarding?" }).textContent).toContain(
      "New synthetic or redacted messages sent to this address will be accepted for review."
    );
  });

  it("returns focus to the trigger after cancel", async () => {
    const user = userEvent.setup();
    render(<EmailSetupPanel initialSetup={setupView()} />);
    const trigger = screen.getByRole("button", { name: "Rotate test address" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(trigger).toBe(document.activeElement);
  });

  it("moves focus to the status heading after a successful action", async () => {
    const user = userEvent.setup();
    render(<EmailSetupPanel initialSetup={setupView()} />);

    await user.click(screen.getByRole("button", { name: "Disable email forwarding" }));
    await user.click(screen.getByRole("button", { name: "Disable forwarding" }));

    const heading = await screen.findByRole("heading", { name: "Waiting" });
    await waitFor(() => expect(heading).toBe(document.activeElement));
  });

  it("blocks repeated confirmation while pending", async () => {
    const user = userEvent.setup();
    let finish: ((value: unknown) => void) | undefined;
    actionMocks.rotate.mockImplementation(
      () => new Promise((resolve) => { finish = resolve; })
    );
    render(<EmailSetupPanel initialSetup={setupView()} />);

    await user.click(screen.getByRole("button", { name: "Rotate test address" }));
    const confirm = screen.getByRole("button", { name: "Rotate address" });
    await user.dblClick(confirm);

    expect(actionMocks.rotate).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Rotating address" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      finish?.({ ok: true, setup: setupView() });
    });
  });

  it("keeps a safe action error inside the dialog and permits retry", async () => {
    const user = userEvent.setup();
    actionMocks.disconnect.mockResolvedValueOnce({ ok: false, error: "Unable to disconnect email testing." });
    render(<EmailSetupPanel initialSetup={setupView()} />);

    await user.click(screen.getByRole("button", { name: "Disconnect email forwarding" }));
    await user.click(screen.getByRole("button", { name: "Disconnect email" }));

    const dialog = screen.getByRole("dialog", { name: "Disconnect email forwarding?" });
    expect(within(dialog).getByRole("alert").textContent).toBe("Unable to disconnect email testing.");
    expect(screen.queryByText("Unable to disconnect email testing.", { selector: "body > *" })).toBeNull();
  });

  it("reports exact deletion counts after success", async () => {
    const user = userEvent.setup();
    render(<EmailSetupPanel initialSetup={setupView()} />);

    await user.click(screen.getByRole("button", { name: "Delete pending test drafts" }));
    await user.click(screen.getByRole("button", { name: "Delete pending drafts" }));

    expect(await screen.findByText("Deleted 2 pending test drafts.")).not.toBeNull();
  });
});

describe("EmailSetupPanel responsive access", () => {
  it("gives every interactive target a mobile touch target and respects reduced motion", () => {
    const { container } = render(<EmailSetupPanel initialSetup={setupView({ reviewCaptureKey: captureKey })} />);

    const targets = container.querySelectorAll("button, a[href]");
    expect(targets.length).toBeGreaterThan(0);
    expect(Array.from(targets).every((target) => target.classList.contains("min-h-11"))).toBe(true);
    expect(container.querySelectorAll(".motion-reduce\\:transition-none").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toMatch(/(?:min-|max-)?w-\[(?:37[6-9]|3[89]\d|[4-9]\d\d|\d{4,})px\]/);
  });
});
