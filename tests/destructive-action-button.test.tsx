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

    const trigger = screen.getByRole("button", {
      name: "Delete Food category"
    });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "Delete this category?"
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toBe(document.activeElement);
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

  it("keeps the dialog open and displays a returned safe failure", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({
      error: "This category is still used by transactions.",
      ok: false as const
    }));

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
    await user.click(
      screen.getByRole("button", {
        name: "Delete Food category permanently"
      })
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This category is still used by transactions."
    );
    expect(
      screen.getByRole("dialog", { name: "Delete this category?" })
    ).not.toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Delete Food category permanently"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it("contains rejected action details and displays a safe generic failure", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => {
      throw new Error("private database constraint detail");
    });

    render(
      <DestructiveActionButton
        action={action}
        description="This project will be permanently removed."
        itemLabel="Launch project"
        title="Delete this project?"
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Launch project" })
    );
    await user.click(
      screen.getByRole("button", {
        name: "Delete Launch project permanently"
      })
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Unable to delete this item. Please try again."
    );
    expect(alert.textContent).not.toContain("private database constraint detail");
    expect(
      screen.getByRole("dialog", { name: "Delete this project?" })
    ).not.toBeNull();
  });

  it("permits a successful retry after a returned failure", async () => {
    const user = userEvent.setup();
    const action = vi
      .fn()
      .mockResolvedValueOnce({ error: "Unable to delete yet.", ok: false })
      .mockResolvedValueOnce({ ok: true });

    render(
      <DestructiveActionButton
        action={action}
        description="This goal will be permanently removed."
        itemLabel="Travel goal"
        title="Delete this goal?"
      />
    );

    const trigger = screen.getByRole("button", { name: "Delete Travel goal" });
    await user.click(trigger);
    await user.click(
      screen.getByRole("button", { name: "Delete Travel goal permanently" })
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to delete yet."
    );

    await user.click(
      screen.getByRole("button", { name: "Delete Travel goal permanently" })
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(action).toHaveBeenCalledTimes(2);
    expect(trigger).toBe(document.activeElement);
  });

  it("clears a prior failure after cancel and reopen", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({
      error: "Unable to delete yet.",
      ok: false as const
    }));

    render(
      <DestructiveActionButton
        action={action}
        description="This account will be permanently removed."
        itemLabel="Savings account"
        title="Delete this account?"
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Delete Savings account"
    });
    await user.click(trigger);
    await user.click(
      screen.getByRole("button", {
        name: "Delete Savings account permanently"
      })
    );
    expect(await screen.findByRole("alert")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(trigger);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Delete this account?" })
    ).not.toBeNull();
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
