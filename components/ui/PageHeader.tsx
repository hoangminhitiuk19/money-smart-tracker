import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  action?: ReactNode;
};

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <header className="mb-6 mt-2 flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
      <h1 className="text-3xl font-bold tracking-normal text-slate-950">
        {title}
      </h1>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
