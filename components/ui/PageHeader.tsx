import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  action?: ReactNode;
};

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <header className="mb-6 mt-2 flex flex-col items-stretch justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
      <h1 className="text-3xl font-bold tracking-normal text-slate-950">
        {title}
      </h1>
      {action ? (
        <div className="w-full shrink-0 sm:w-auto">{action}</div>
      ) : null}
    </header>
  );
}
