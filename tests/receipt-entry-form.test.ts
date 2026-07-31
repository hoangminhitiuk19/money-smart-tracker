import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptEntryForm } from "@/components/receipt-entry-form";
import { createTransaction } from "@/lib/actions/transactions";

const testState = vi.hoisted(() => ({
  pendingTransition: Promise.resolve()
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useEffect: vi.fn(),
    useState: vi.fn((initialValue: unknown) => [initialValue, vi.fn()]),
    useTransition: vi.fn(() => [
      false,
      (callback: () => void | Promise<void>) => {
        testState.pendingTransition = Promise.resolve(callback());
      }
    ])
  };
});

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn()
  }))
}));

vi.mock("@/lib/actions/transactions", () => ({
  createTransaction: vi.fn(async () => ({ ok: true }))
}));

function findElement(node: ReactNode, type: string): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, type);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isValidElement(node)) {
    return null;
  }

  if (node.type === type) {
    return node;
  }

  return findElement(
    (node.props as { children?: ReactNode }).children ?? null,
    type
  );
}

describe("receipt transaction entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.pendingTransition = Promise.resolve();
  });

  it("sends the amount to createTransaction as exact text", async () => {
    const values = new Map<string, string>([
      ["amount", "90071992547409.99"],
      ["description", "Receipt note"],
      ["title", "Receipt purchase"],
      ["transactionDate", "2026-07-30"]
    ]);
    class FakeFormData {
      get(key: string) {
        return values.get(key) ?? null;
      }
    }
    vi.stubGlobal("FormData", FakeFormData);
    const tree = ReceiptEntryForm({
      categories: [],
      moneySources: []
    });
    const form = findElement(tree, "form");

    expect(form).not.toBeNull();
    (
      form?.props as {
        onSubmit: (event: {
          currentTarget: unknown;
          preventDefault: () => void;
        }) => void;
      }
    ).onSubmit({
      currentTarget: {},
      preventDefault: vi.fn()
    });
    await testState.pendingTransition;

    expect(createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "90071992547409.99" })
    );
  });
});
