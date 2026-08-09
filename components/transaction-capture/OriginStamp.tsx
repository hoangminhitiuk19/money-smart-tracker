export type CaptureOrigin = "QUICK" | "PASTE" | "EMAIL";

const originLabels: Record<CaptureOrigin, string> = {
  QUICK: "Quick entry",
  PASTE: "Pasted spreadsheet row",
  EMAIL: "Forwarded email candidate"
};

type OriginStampProps = {
  origin: CaptureOrigin;
};

export function OriginStamp({ origin }: OriginStampProps) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-sm border border-slate-300 bg-white px-1.5 font-capture-data text-[0.6875rem] font-semibold tracking-[0.08em] text-capture-ink">
      <span aria-hidden="true">{origin}</span>
      <span className="sr-only">{originLabels[origin]}</span>
    </span>
  );
}
