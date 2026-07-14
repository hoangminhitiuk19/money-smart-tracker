type BadgeVariant =
  | "income"
  | "expense"
  | "transfer"
  | "refund"
  | "adjustment"
  | "s"
  | "a"
  | "b"
  | "c"
  | "d"
  | "active"
  | "paused"
  | "cancelled";

type BadgeProps = {
  variant: BadgeVariant;
  label: string;
  dot?: boolean;
};

const variantClasses: Record<BadgeVariant, string> = {
  income: "bg-income/10 text-income",
  expense: "bg-expense/10 text-expense",
  transfer: "bg-transfer/10 text-transfer",
  refund: "bg-refund/10 text-refund",
  adjustment: "bg-adjustment/10 text-adjustment",
  s: "bg-quality-s/10 text-quality-s",
  a: "bg-quality-a/10 text-quality-a",
  b: "bg-quality-b/10 text-quality-b",
  c: "bg-quality-c/10 text-quality-c",
  d: "bg-quality-d/10 text-quality-d",
  active: "bg-income/10 text-income",
  paused: "bg-quality-c/10 text-quality-c",
  cancelled: "bg-expense/10 text-expense"
};

export function Badge({ variant, label, dot }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        variantClasses[variant]
      ].join(" ")}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      ) : null}
      {label}
    </span>
  );
}
