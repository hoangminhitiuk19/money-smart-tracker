export type CaptureOrigin = "QUICK" | "PASTE";

const originLabels: Record<CaptureOrigin, string> = {
  QUICK: "Quick entry row",
  PASTE: "Pasted spreadsheet row"
};

type OriginStampProps = {
  origin: CaptureOrigin;
};

export function OriginStamp({ origin }: OriginStampProps) {
  return (
    <span
      aria-label={originLabels[origin]}
      className="inline-flex min-h-6 items-center rounded-sm border border-slate-300 bg-white px-1.5 font-capture-data text-[0.6875rem] font-semibold tracking-[0.08em] text-capture-ink"
    >
      {origin}
    </span>
  );
}
