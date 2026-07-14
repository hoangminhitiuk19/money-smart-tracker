type LoadingSkeletonProps = {
  rows: number;
  height: number | string;
};

export function LoadingSkeleton({ rows, height }: LoadingSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          className="animate-pulse rounded-md bg-slate-200"
          key={index}
          style={{ height }}
        />
      ))}
    </div>
  );
}
