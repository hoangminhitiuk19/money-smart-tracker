import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padded?: boolean;
};

export function Card({
  title,
  action,
  children,
  className,
  hover,
  padded = true
}: CardProps) {
  return (
    <section
      className={[
        "rounded-xl border border-slate-200/70 bg-card-bg shadow-sm transition",
        padded ? "p-6" : "",
        hover ? "hover:-translate-y-0.5 hover:shadow-md" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {title ? (
        <div
          className={[
            "flex items-center justify-between gap-3",
            padded ? "mb-4" : "border-b border-slate-100 p-4"
          ].join(" ")}
        >
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">
            {title}
          </h2>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
