import { CaptureMethodNav } from "@/components/transaction-capture/CaptureMethodNav";

function EmailSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none ${className}`}
    />
  );
}

export default function InboundEmailLoading() {
  return (
    <main className="min-w-0 overflow-x-clip bg-capture-canvas px-4 py-6 font-capture-ui text-capture-ink sm:px-6 lg:px-8">
      <div
        aria-label="Email setup loading"
        className="mx-auto min-w-0 max-w-5xl space-y-5"
      >
        <header className="space-y-4 border-b border-slate-200 pb-5">
          <div>
            <p className="font-capture-data text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-capture-primary">
              Private test route
            </p>
            <h1 className="mt-2 font-capture-display text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
              Email forwarding
            </h1>
            <EmailSkeleton className="mt-3 h-4 max-w-xl" />
          </div>
          <CaptureMethodNav active="email" />
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <EmailSkeleton className="h-12 w-full" />
        </section>

        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
            <EmailSkeleton className="h-5 w-40" />
            <EmailSkeleton className="mt-4 h-24 w-full" />
            <EmailSkeleton className="mt-4 h-11 w-36" />
          </section>
          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
            <EmailSkeleton className="h-5 w-36" />
            <EmailSkeleton className="mt-4 h-20 w-full" />
            <EmailSkeleton className="mt-4 h-11 w-40" />
          </section>
        </div>
      </div>
    </main>
  );
}
