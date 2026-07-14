import { forwardRef, type SelectHTMLAttributes } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        className={[
          "min-h-11 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:min-h-0",
          className
        ]
          .filter(Boolean)
          .join(" ")}
        ref={ref}
        {...props}
      />
    );
  }
);
