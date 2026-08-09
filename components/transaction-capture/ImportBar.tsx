"use client";

type ImportBarProps = {
  duplicateCount: number;
  error: string | null;
  importing: boolean;
  needsReviewCount: number;
  onAbandon: () => void;
  onSave: () => void;
  readyCount: number;
  selectedCount: number;
  canSave: boolean;
};

function transactionLabel(count: number) {
  return count === 1 ? "transaction" : "transactions";
}

export function ImportBar({
  canSave,
  duplicateCount,
  error,
  importing,
  needsReviewCount,
  onAbandon,
  onSave,
  readyCount,
  selectedCount
}: ImportBarProps) {
  const retrying = error === "Check your connection and try again.";
  const actionLabel = retrying
    ? "Try saving again"
    : selectedCount > 0 && canSave
      ? `Save ${selectedCount} ${transactionLabel(selectedCount)}`
      : "Save selected transactions";

  return (
    <section
      aria-label="Import selected transactions"
      className="sticky bottom-0 z-10 mt-4 border-y border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(23,32,51,0.08)] backdrop-blur sm:rounded-xl sm:border"
    >
      <div className="mx-auto flex max-w-[90rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-capture-data text-xs text-slate-600">
            {readyCount} ready · {needsReviewCount} need attention
          </p>
          <p className="font-capture-data text-sm font-semibold text-capture-ink">
            {selectedCount} selected · {readyCount} ready · {needsReviewCount} need attention · {duplicateCount} duplicate
          </p>
          {error ? <p className="mt-1 text-sm text-capture-error" role="status">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {retrying ? (
            <button
              className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold text-capture-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary"
              onClick={onAbandon}
              type="button"
            >
              Abandon this save attempt
            </button>
          ) : null}
          <button
            className="min-h-11 rounded-md bg-capture-primary px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSave || importing}
            onClick={onSave}
            type="button"
          >
            {importing ? "Saving transactions" : actionLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
