import {
  presentationNumber,
  type DecimalInput
} from "@/lib/money";

type ProgressBarProps = {
  percent: DecimalInput;
  color?: string;
};

function clampWidth(percent: DecimalInput) {
  const presentationPercent = presentationNumber(percent);

  return `${Math.min(100, Math.max(0, presentationPercent))}%`;
}

export function ProgressBar({ percent, color = "#4f46e5" }: ProgressBarProps) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: clampWidth(percent),
          backgroundImage: `linear-gradient(90deg, ${color}99, ${color})`
        }}
      />
    </div>
  );
}
