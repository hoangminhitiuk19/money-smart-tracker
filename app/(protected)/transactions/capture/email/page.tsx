import type { ReactNode } from "react";
import { EmailSetupPanel } from "@/components/inbound-email/EmailSetupPanel";
import { CaptureMethodNav } from "@/components/transaction-capture/CaptureMethodNav";
import { Card } from "@/components/ui/Card";
import { getInboundEmailSetup } from "@/lib/actions/inbound-email";
import { requireAuth } from "@/lib/auth";

function EmailPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-w-0 overflow-x-clip bg-capture-canvas px-4 py-6 font-capture-ui text-capture-ink sm:px-6 lg:px-8">
      <div className="mx-auto min-w-0 max-w-5xl space-y-5">
        <header className="space-y-4 border-b border-slate-200 pb-5">
          <div>
            <p className="font-capture-data text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-capture-primary">
              Private test route
            </p>
            <h1 className="mt-2 font-capture-display text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
              Email forwarding
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Forward one controlled example and review the resulting draft before anything enters your ledger.
            </p>
          </div>
          <CaptureMethodNav active="email" />
        </header>
        {children}
      </div>
    </main>
  );
}

export default async function InboundEmailPage() {
  await requireAuth();
  const result = await getInboundEmailSetup();

  if (!result.ok) {
    return (
      <EmailPageShell>
        <Card title="Email forwarding unavailable">
          <p className="text-sm leading-6 text-slate-600" role="alert">
            Unable to load email forwarding. Refresh this page to try again.
          </p>
        </Card>
      </EmailPageShell>
    );
  }

  return (
    <EmailPageShell>
      <EmailSetupPanel initialSetup={result.setup} />
    </EmailPageShell>
  );
}
