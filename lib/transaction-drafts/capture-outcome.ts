import type { TransactionDraftView } from "@/lib/transaction-drafts/types";

export type CaptureOutcomeKind = "active" | "imported" | "dismissed" | "unavailable";

type CaptureDraftState = Pick<
  TransactionDraftView,
  "status" | "importedTransactionId"
>;

export type CaptureOutcome<T extends CaptureDraftState> = {
  kind: CaptureOutcomeKind;
  activeDrafts: T[];
  importedCount: number;
  importedTransactionIds: string[];
};

function isTerminal(status: TransactionDraftView["status"]) {
  return status === "IMPORTED" || status === "DISMISSED";
}

// Imported and dismissed drafts have their candidate values cleared, so they
// are summarized as an outcome instead of being shown as editable rows.
export function deriveCaptureOutcome<T extends CaptureDraftState>(
  drafts: readonly T[]
): CaptureOutcome<T> {
  const activeDrafts = drafts.filter(({ status }) => !isTerminal(status));
  const imported = drafts.filter(({ status }) => status === "IMPORTED");
  const importedTransactionIds = Array.from(
    new Set(
      imported.flatMap(({ importedTransactionId }) =>
        importedTransactionId ? [importedTransactionId] : []
      )
    )
  );
  const kind: CaptureOutcomeKind =
    drafts.length === 0
      ? "unavailable"
      : activeDrafts.length > 0
        ? "active"
        : imported.length > 0
          ? "imported"
          : "dismissed";

  return {
    kind,
    activeDrafts,
    importedCount: imported.length,
    importedTransactionIds
  };
}
