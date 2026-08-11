import Link from "next/link";

type CaptureMethodNavProps = {
  active: "manual" | "email";
};

const methods = [
  {
    id: "manual" as const,
    href: "/transactions/capture",
    label: "Quick and paste"
  },
  {
    id: "email" as const,
    href: "/transactions/capture/email",
    label: "Email forwarding"
  }
];

export function CaptureMethodNav({ active }: CaptureMethodNavProps) {
  return (
    <nav aria-label="Capture method" className="min-w-0">
      <div className="flex min-w-0 flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {methods.map((method) => {
          const current = active === method.id;

          return (
            <Link
              key={method.id}
              href={method.href}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-11 min-w-0 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary ${
                current
                  ? "bg-capture-primary text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-capture-ink"
              }`}
            >
              {method.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
