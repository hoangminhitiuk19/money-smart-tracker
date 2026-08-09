function CaptureSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none ${className}`}
    />
  );
}

export default function TransactionCaptureLoading() {
  return (
    <section className="min-w-0 overflow-x-clip bg-capture-canvas px-4 py-6 font-capture-ui text-capture-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[90rem] space-y-5">
        <header className="border-b border-slate-200 pb-5">
          <p className="font-capture-data text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-capture-primary">
            Living ledger
          </p>
          <h1 className="mt-2 font-capture-display text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
            Capture transactions
          </h1>
          <CaptureSkeleton className="mt-3 h-4 max-w-xl" />
        </header>

        <div
          aria-label="Capture method loading"
          className="flex gap-2 rounded-lg border border-slate-200 bg-white p-2"
        >
          <CaptureSkeleton className="h-11 w-28" />
          <CaptureSkeleton className="h-11 w-28" />
        </div>

        <section
          aria-label="Paste rows loading"
          className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
        >
          <h2 className="font-capture-display text-lg font-semibold">Paste rows</h2>
          <CaptureSkeleton className="mt-4 h-32 w-full" />
        </section>

        <section aria-label="Review ledger loading" className="space-y-3">
          <h2 className="font-capture-display text-lg font-semibold">Review ledger</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[5rem_8rem_minmax(12rem,1fr)_8rem] gap-3 border-b border-slate-200 p-4">
              <CaptureSkeleton className="h-4" />
              <CaptureSkeleton className="h-4" />
              <CaptureSkeleton className="h-4" />
              <CaptureSkeleton className="h-4" />
            </div>
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                className="grid grid-cols-[5rem_8rem_minmax(12rem,1fr)_8rem] gap-3 border-b border-slate-100 p-4 last:border-b-0"
                key={index}
              >
                <CaptureSkeleton className="h-5" />
                <CaptureSkeleton className="h-5" />
                <CaptureSkeleton className="h-5" />
                <CaptureSkeleton className="h-5" />
              </div>
            ))}
          </div>
        </section>

        <aside
          aria-label="Capture summary loading"
          className="sticky bottom-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CaptureSkeleton className="h-5 w-48" />
            <CaptureSkeleton className="h-11 w-40" />
          </div>
        </aside>
      </div>
    </section>
  );
}
