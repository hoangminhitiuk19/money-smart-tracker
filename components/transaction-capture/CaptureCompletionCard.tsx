import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { TransactionsIcon } from "@/components/ui/icons";
import type { TransactionCaptureState } from "@/lib/actions/transaction-drafts";

export type CaptureCompletionState = Exclude<
  TransactionCaptureState,
  { kind: "active" }
>;

const linkFocus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryLinkClass = `inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 motion-reduce:transition-none ${linkFocus}`;
const secondaryLinkClass = `inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 motion-reduce:transition-none ${linkFocus}`;

function StartAnotherCapture({ primary = false }: { primary?: boolean }) {
  return (
    <Link
      className={primary ? primaryLinkClass : secondaryLinkClass}
      href="/transactions/capture"
    >
      Start another capture
    </Link>
  );
}

function transactionWord(count: number) {
  return count === 1 ? "transaction" : "transactions";
}

function ImportedActions({
  transactionIds
}: {
  transactionIds: readonly string[];
}) {
  const single = transactionIds.length === 1;

  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Link
        className={primaryLinkClass}
        href={single ? `/transactions/${transactionIds[0]}/edit` : "/transactions"}
      >
        {single ? "View transaction" : "View transactions"}
      </Link>
      <StartAnotherCapture />
    </div>
  );
}

export function CaptureCompletionCard({
  state
}: {
  state: CaptureCompletionState;
}) {
  switch (state.kind) {
    case "imported":
      return (
        <EmptyState
          cta={<ImportedActions transactionIds={state.transactionIds} />}
          icon={<TransactionsIcon className="h-6 w-6" />}
          subtitle="The draft details were removed after import to protect your privacy. The saved transaction keeps everything you reviewed."
          title={
            state.importedCount === 1
              ? "Transaction imported"
              : `${state.importedCount} ${transactionWord(state.importedCount)} imported`
          }
        />
      );
    case "dismissed":
      return (
        <EmptyState
          cta={<StartAnotherCapture primary />}
          subtitle="Nothing was imported from this capture, and its draft details were removed."
          title="Draft dismissed"
        />
      );
    case "failed":
      return (
        <EmptyState
          cta={<StartAnotherCapture />}
          subtitle="This capture could not be loaded right now. Refresh the page to try again."
          title="Capture temporarily unavailable"
        />
      );
    case "unavailable":
      return (
        <EmptyState
          cta={<StartAnotherCapture primary />}
          subtitle="This capture does not exist, has expired, or is no longer available."
          title="Capture unavailable"
        />
      );
  }
}

export function CaptureImportedNotice({ count }: { count: number }) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-capture-confirmed"
      role="status"
    >
      <span>
        {count} {transactionWord(count)} already imported from this capture.
      </span>
      <Link
        className={`inline-flex min-h-11 items-center font-semibold underline ${linkFocus}`}
        href="/transactions"
      >
        View transactions
      </Link>
    </p>
  );
}
