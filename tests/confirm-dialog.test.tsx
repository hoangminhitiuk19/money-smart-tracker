// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

afterEach(cleanup);

type DialogHarnessProps = {
  onCancel?: () => void;
  pendingAfterConfirm?: boolean;
};

function DialogHarness({
  onCancel,
  pendingAfterConfirm = false
}: DialogHarnessProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} type="button">
        Open confirmation
      </button>
      <a href="#outside">Outside link</a>
      {isOpen ? (
        <ConfirmDialog
          description="This record will be permanently removed."
          isPending={isPending}
          onCancel={() => {
            onCancel?.();
            setIsOpen(false);
          }}
          onConfirm={() => {
            if (pendingAfterConfirm) {
              setIsPending(true);
              return;
            }
            setIsOpen(false);
          }}
          title="Delete this record?"
        />
      ) : null}
    </>
  );
}

describe("ConfirmDialog keyboard and focus behavior", () => {
  it("moves initial focus to the safest action", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(
      screen.getByRole("button", { name: "Open confirmation" })
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBe(
      document.activeElement
    );
  });

  it("contains forward and reverse Tab navigation among modal controls", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(
      screen.getByRole("button", { name: "Open confirmation" })
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete this record?"
    });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Delete" });

    await user.tab({ shift: true });
    expect(confirm).toBe(document.activeElement);
    await user.tab();
    expect(cancel).toBe(document.activeElement);
    await user.tab();
    expect(confirm).toBe(document.activeElement);
    await user.tab();
    expect(cancel).toBe(document.activeElement);
  });

  it("prevents focus from moving behind the modal", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    await user.click(trigger);

    trigger.focus();

    const dialog = screen.getByRole("dialog", {
      name: "Delete this record?"
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBe(
      document.activeElement
    );
  });

  it("closes on Escape when safe and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toBe(document.activeElement);
  });

  it("restores trigger focus after confirmation", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toBe(document.activeElement);
  });

  it("ignores repeated Escape while confirmation is pending", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <DialogHarness onCancel={onCancel} pendingAfterConfirm={true} />
    );

    await user.click(
      screen.getByRole("button", { name: "Open confirmation" })
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.keyboard("{Escape}{Escape}");

    const dialog = screen.getByRole("dialog", {
      name: "Delete this record?"
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
