import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";

export default function TransactionsLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        action={
          <div aria-hidden="true" className="flex gap-2">
            <div className="h-11 w-40 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none" />
            <div className="h-11 w-28 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none" />
          </div>
        }
        title="Transactions"
      />

      <section
        aria-label="Transaction filters loading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <LoadingSkeleton height={44} rows={3} />
      </section>

      <section
        aria-label="Transaction ledger loading"
        className="overflow-hidden rounded-lg border border-slate-200 bg-white p-5"
      >
        <LoadingSkeleton height={52} rows={6} />
      </section>
    </div>
  );
}
