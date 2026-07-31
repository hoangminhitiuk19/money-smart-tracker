// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ReceiptUploadLoading from "@/app/(protected)/receipt-upload/loading";
import SettingsLoading from "@/app/(protected)/settings/loading";

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
});
