import {
  isValidElement,
  type ReactElement,
  type ReactNode
} from "react";
import { describe, expect, it, vi } from "vitest";
import { MoneySourceForm } from "@/components/money-source-form";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useRef: vi.fn(() => ({ current: null })),
    useState: vi.fn((initialValue: unknown) => [initialValue, vi.fn()]),
    useTransition: vi.fn(() => [false, vi.fn()])
  };
});

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() }))
}));

vi.mock("@/lib/actions/money-sources", () => ({
  createMoneySource: vi.fn(async () => ({ ok: false, error: "Save failed." })),
  updateMoneySource: vi.fn(async () => ({ ok: false, error: "Save failed." }))
}));

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isValidElement(node)) {
    return null;
  }

  if (predicate(node)) {
    return node;
  }

  return findElement(
    (node.props as { children?: ReactNode }).children ?? null,
    predicate
  );
}

describe("money source form async errors", () => {
  it("provides a persistent assertive alert region for save failures", () => {
    const tree = MoneySourceForm({});
    const alert = findElement(
      tree,
      (element) =>
        (element.props as { role?: string }).role === "alert"
    );

    expect(alert).not.toBeNull();
    expect(
      (alert?.props as { "aria-live"?: string })["aria-live"]
    ).toBe("assertive");
  });
});
