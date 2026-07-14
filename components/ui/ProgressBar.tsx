type ProgressBarProps = {
  percent: number;
  color?: string;
};

function clampWidth(percent: number) {
  return `${Math.min(100, Math.max(0, percent))}%`;
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
