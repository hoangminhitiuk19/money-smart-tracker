// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DestructiveActionButton } from "@/components/destructive-action-button";

afterEach(cleanup);

describe("DestructiveActionButton", () => {
  it("keeps the action untouched when the user cancels", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => undefined);

    render(
      <DestructiveActionButton
        action={action}
        description="This category will be permanently removed."
        itemLabel="Food category"
        title="Delete this category?"
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Food category" })
    );
    const dialog = screen.getByRole("dialog", {
      name: "Delete this category?"
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("invokes the action exactly once after confirmation", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => undefined);

    render(
      <DestructiveActionButton
        action={action}
        description="This account will be permanently removed."
        itemLabel="Cash account"
        title="Delete this account?"
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Cash account" })
    );
    await user.click(
      screen.getByRole("button", { name: "Delete Cash account permanently" })
    );

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("blocks double submission and exposes the pending state", async () => {
    const user = userEvent.setup();
    let finishAction: (() => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        })
    );

    render(
      <DestructiveActionButton
        action={action}
        description="This goal will be permanently removed."
        itemLabel="Emergency fund goal"
        title="Delete this goal?"
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Emergency fund goal" })
    );
    const confirm = screen.getByRole("button", {
      name: "Delete Emergency fund goal permanently"
    }) as HTMLButtonElement;
    await user.dblClick(confirm);

    expect(action).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);
    expect(
      screen
        .getByRole("dialog", { name: "Delete this goal?" })
        .getAttribute("aria-busy")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Deleting Emergency fund goal" })
    ).not.toBeNull();

    finishAction?.();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("gives the trigger, dialog, and confirmation distinct accessible names", async () => {
    const user = userEvent.setup();

    render(
      <DestructiveActionButton
        action={async () => undefined}
        description="This contribution will be permanently removed."
        itemLabel="July contribution"
        title="Delete this contribution?"
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Delete July contribution" })
    );

    const dialog = screen.getByRole("dialog", {
      name: "Delete this contribution?"
    });
    expect(
      within(dialog).getByText(
        "This contribution will be permanently removed."
      )
    ).not.toBeNull();
    expect(
      within(dialog).getByRole("button", {
        name: "Delete July contribution permanently"
      })
    ).not.toBeNull();
  });
});
