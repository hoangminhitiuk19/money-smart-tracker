import type { ReactNode } from "react";

type EmptyStateProps = {
  title: ReactNode;
  subtitle: string;
  cta?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, subtitle, cta, icon }: EmptyStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? (
          <svg
            aria-hidden="true"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M8 7h8" />
            <path d="M8 11h8" />
            <path d="M8 15h5" />
            <path d="M6 3h9l3 3v15H6z" />
            <path d="M15 3v4h4" />
          </svg>
        )}
      </div>
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-500">{subtitle}</p>
      {cta ? <div className="mt-6">{cta}</div> : null}
    </div>
  );
}
