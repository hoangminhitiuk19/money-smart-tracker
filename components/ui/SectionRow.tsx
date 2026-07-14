import type { ReactNode } from "react";

type SectionRowProps = {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  trailingSubtitle?: ReactNode;
};

export function SectionRow({
  icon,
  title,
  subtitle,
  trailing,
  trailingSubtitle
}: SectionRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-950">{title}</p>
          {subtitle ? (
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {trailing !== undefined ? (
        <div className="shrink-0 text-right">
          <p className="font-semibold text-slate-950">{trailing}</p>
          {trailingSubtitle ? (
            <p className="text-xs text-slate-500">{trailingSubtitle}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
