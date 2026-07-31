// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedLayout from "@/app/(protected)/layout";

const layoutMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  headers: vi.fn()
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

vi.mock("next/headers", () => ({
  headers: layoutMocks.headers
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: layoutMocks.requireAuth
}));

vi.mock("@/components/logout-button", () => ({
  LogoutButton: () => <button type="button">Log out</button>
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  layoutMocks.requireAuth.mockResolvedValue({
    id: "nav-user",
    email: "nav@example.com",
    name: "Navigation User"
  });
  layoutMocks.headers.mockResolvedValue({
    get: (name: string) =>
      name === "x-next-url" ? "/categories/annual-fees" : null
  });
});

describe("protected navigation", () => {
  it("exposes active Categories links in both desktop and mobile navigation", async () => {
    render(
      await ProtectedLayout({
        children: <p>Protected content</p>
      })
    );

    const navigations = screen.getAllByRole("navigation", { hidden: true });
    expect(navigations).toHaveLength(2);

    for (const navigation of navigations) {
      const links = within(navigation).getAllByRole("link", { hidden: true });
      const categoryLink = within(navigation).getByRole("link", {
        hidden: true,
        name: "Categories"
      });

      expect(links.slice(0, 4).map((link) => link.textContent)).toEqual([
        "Dashboard",
        "Transactions",
        "Categories",
        "Receipt Upload"
      ]);
      expect(categoryLink.getAttribute("href")).toBe("/categories");
      expect(categoryLink.getAttribute("aria-current")).toBe("page");
      expect(categoryLink.className.split(" ")).toContain("min-h-11");
    }
  });
});
