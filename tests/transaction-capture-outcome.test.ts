import { describe, expect, it } from "vitest";
import { deriveCaptureOutcome } from "@/lib/transaction-drafts/capture-outcome";
import type { TransactionDraftView } from "@/lib/transaction-drafts/types";

type DraftState = Pick<
  TransactionDraftView,
  "id" | "status" | "importedTransactionId"
>;

function draft(
  id: string,
  status: DraftState["status"],
  importedTransactionId: string | null = null
): DraftState {
  return { id, status, importedTransactionId };
}

describe("deriveCaptureOutcome", () => {
  it("reports an empty capture as unavailable", () => {
    expect(deriveCaptureOutcome([])).toEqual({
      kind: "unavailable",
      activeDrafts: [],
      importedCount: 0,
      importedTransactionIds: []
    });
  });

  it("keeps reviewable and in-flight rows editable", () => {
    const rows = [
      draft("a", "NEEDS_REVIEW"),
      draft("b", "READY"),
      draft("c", "IMPORTING")
    ];

    expect(deriveCaptureOutcome(rows)).toEqual({
      kind: "active",
      activeDrafts: rows,
      importedCount: 0,
      importedTransactionIds: []
    });
  });

  it("filters terminal rows out of a mixed capture and counts imports", () => {
    const outcome = deriveCaptureOutcome([
      draft("a", "IMPORTED", "tx-1"),
      draft("b", "READY"),
      draft("c", "DISMISSED")
    ]);

    expect(outcome.kind).toBe("active");
    expect(outcome.activeDrafts.map(({ id }) => id)).toEqual(["b"]);
    expect(outcome.importedCount).toBe(1);
    expect(outcome.importedTransactionIds).toEqual(["tx-1"]);
  });

  it("reports an imported-only capture with unique transaction ids", () => {
    expect(
      deriveCaptureOutcome([
        draft("a", "IMPORTED", "tx-1"),
        draft("b", "IMPORTED", "tx-2"),
        draft("c", "IMPORTED", "tx-1"),
        draft("d", "IMPORTED", null)
      ])
    ).toEqual({
      kind: "imported",
      activeDrafts: [],
      importedCount: 4,
      importedTransactionIds: ["tx-1", "tx-2"]
    });
  });

  it("treats imported plus dismissed rows as imported", () => {
    expect(
      deriveCaptureOutcome([
        draft("a", "DISMISSED"),
        draft("b", "IMPORTED", "tx-1")
      ])
    ).toMatchObject({ kind: "imported", importedCount: 1 });
  });

  it("reports a dismissed-only capture as dismissed", () => {
    expect(
      deriveCaptureOutcome([draft("a", "DISMISSED"), draft("b", "DISMISSED")])
    ).toEqual({
      kind: "dismissed",
      activeDrafts: [],
      importedCount: 0,
      importedTransactionIds: []
    });
  });
});
