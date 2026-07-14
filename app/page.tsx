import Link from "next/link";
import { Button } from "@/components/ui/Button";

const features = [
  "Track income, expenses, transfers, refunds, and adjustments manually.",
  "Rate spending quality and use category defaults to reduce busywork.",
  "Save toward multiple goals and track flexible contributions.",
  "Manage accounts, wallets, credit cards, debt, and card credit.",
  "Monitor annual fees, waiver progress, renewals, reports, and CSV exports."
];

export default function Home() {
  return (
    <main className="min-h-screen bg-page-bg text-slate-950">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
            M
          </span>
          <span className="text-[15px] font-semibold text-slate-950">
            Money Quality Tracker
          </span>
        </div>
        <Link className="text-sm font-medium text-slate-600 hover:text-slate-950" href="/login">
          Log in
        </Link>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          Personal finance with judgment
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Money Quality Tracker
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          Track not only where your money goes, but whether it was worth it.
        </p>
        <div className="mt-8">
          <Link href="/register">
            <Button size="lg" variant="primary">
              Get Started
            </Button>
          </Link>
        </div>
        <ul className="mt-12 grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li
              className="rounded-xl border border-slate-200/70 bg-card-bg px-4 py-3 text-sm text-slate-700 shadow-sm"
              key={feature}
            >
              {feature}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
