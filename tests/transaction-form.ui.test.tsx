import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TransactionForm,
  type TransactionFormInitialValues
} from "@/components/transaction-form";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() }))
}));

vi.mock("@/lib/actions/transactions", () => ({
  createTransaction: vi.fn(async () => ({ ok: true })),
  deleteTransaction: vi.fn(async () => ({ ok: true })),
  updateTransaction: vi.fn(async () => ({ ok: true }))
}));

const moneySources = [
  {
    id: "bank-source",
    name: "Main Bank",
    type: MoneySourceType.BANK_ACCOUNT
  },
  {
    id: "card-source",
    name: "Main Card",
    type: MoneySourceType.CREDIT_CARD
  }
];

function adjustmentValues(
  overrides: Partial<TransactionFormInitialValues> = {}
): TransactionFormInitialValues {
  return {
    id: "adjustment-1",
    type: TransactionType.ADJUSTMENT,
    amount: "15.00",
    currency: "VND",
    title: "Ledger correction",
    description: "Reconcile statement",
    transactionDate: "2026-07-31",
    categoryId: "",
    qualityRating: "",
    fromMoneySourceId: "",
    toMoneySourceId: "",
    adjustedMoneySourceId: "card-source",
    adjustmentDirection: AdjustmentDirection.INCREASE,
    adjustmentTarget: undefined as unknown as AdjustmentTarget,
    projectId: "",
    relatedTransactionId: "",
    countTowardFeeWaiver: false,
    ...overrides
  };
}

function renderAdjustment(initialValues: TransactionFormInitialValues) {
  return renderToStaticMarkup(
    <TransactionForm
      categories={[]}
      expenseTransactions={[]}
      initialValues={initialValues}
      moneySources={moneySources}
      projects={[]}
    />
  );
}

function selectedToggleLabels(markup: string) {
  return Array.from(
    markup.matchAll(
      /<label class="flex-1"><input[^>]*checked=""[^>]*\/><span[^>]*>([^<]+)<\/span><\/label>/g
    ),
    (match) => match[1]
  );
}

describe("TransactionForm ADJUSTMENT controls", () => {
  it("renders the selected source, direction, default debt target, and exact helper text", () => {
    const markup = renderAdjustment(adjustmentValues());

    expect(markup).toContain("Adjusted Source");
    expect(markup).toContain('value="card-source" selected=""');
    expect(markup).toMatch(
      /<input(?=[^>]*name="amount")(?=[^>]*value="15.00")[^>]*>/
    );
    expect(markup).toMatch(
      /<input(?=[^>]*name="title")(?=[^>]*value="Ledger correction")[^>]*>/
    );
    expect(markup).toContain(">Reconcile statement</textarea>");
    expect(markup).toContain("Adjustment Direction");
    expect(markup).toContain("Adjustment Target");
    expect(markup).toContain(">Debt</span>");
    expect(markup).toContain(">Card Credit</span>");
    expect(selectedToggleLabels(markup)).toEqual(["Increase", "Debt"]);
    expect(markup).toContain(
      "This corrects your tracked balance. It does not count as income or expense."
    );
  });

  it("renders the card-credit and decrease toggle selections", () => {
    const markup = renderAdjustment(
      adjustmentValues({
        adjustmentDirection: AdjustmentDirection.DECREASE,
        adjustmentTarget: AdjustmentTarget.CARD_CREDIT
      })
    );

    expect(selectedToggleLabels(markup)).toEqual(["Decrease", "Card Credit"]);
  });

  it("hides the card target for a non-card adjustment", () => {
    const markup = renderAdjustment(
      adjustmentValues({
        adjustedMoneySourceId: "bank-source",
        adjustmentTarget: AdjustmentTarget.CARD_CREDIT
      })
    );

    expect(markup).toContain('value="bank-source" selected=""');
    expect(markup).not.toContain("Adjustment Target");
    expect(markup).not.toContain(">Debt</span>");
    expect(markup).not.toContain(">Card Credit</span>");
    expect(markup).toContain(
      "This corrects your tracked balance. It does not count as income or expense."
    );
  });
});
