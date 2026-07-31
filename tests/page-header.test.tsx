// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "@/components/ui/PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("stacks its action below the title on mobile and restores the desktop row", () => {
    render(
      <PageHeader
        action={<button type="button">Header action</button>}
        title="A long page title"
      />
    );

    const heading = screen.getByRole("heading", {
      name: "A long page title"
    });
    const header = heading.closest("header");
    const actionWrapper = screen.getByRole("button", {
      name: "Header action"
    }).parentElement;

    expect(header).not.toBeNull();
    expect(header?.className.split(" ")).toEqual(
      expect.arrayContaining([
        "flex-col",
        "items-stretch",
        "sm:flex-row",
        "sm:items-center"
      ])
    );
    expect(actionWrapper?.className.split(" ")).toEqual(
      expect.arrayContaining(["w-full", "sm:w-auto"])
    );
  });
});
