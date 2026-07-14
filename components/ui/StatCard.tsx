import type { ReactNode } from "react";

type StatCardProps = {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  accentColor?: string;
  trend?: {
    direction: "up" | "down";
    percent: string | number;
  };
};

export function StatCard({
  value,
  label,
  icon,
  accentColor = "#4f46e5",
  trend
}: StatCardProps) {
  return (
    <section className="rounded-xl border border-slate-200/70 bg-card-bg p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        {icon ? (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${accentColor}1a`, color: accentColor }}
          >
            {icon}
          </div>
        ) : null}
        {trend ? (
          <span
            className={[
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold",
              trend.direction === "up"
                ? "bg-income/10 text-income"
                : "bg-expense/10 text-expense"
            ].join(" ")}
          >
            {trend.direction === "up" ? "↑" : "↓"} {trend.percent}%
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
    </section>
  );
}
