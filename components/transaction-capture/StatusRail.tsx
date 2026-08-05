export type CaptureStatus =
  | "NEEDS_REVIEW"
  | "READY"
  | "IMPORTING"
  | "IMPORTED"
  | "DISMISSED";

type StatusRailProps = {
  status: CaptureStatus;
  issueCount?: number;
};

const statusDetails: Record<
  CaptureStatus,
  { label: string; railClassName: string; icon: "check" | "dot" | "warning" }
> = {
  NEEDS_REVIEW: {
    label: "Needs review",
    railClassName: "bg-capture-review",
    icon: "warning"
  },
  READY: {
    label: "Ready",
    railClassName: "bg-capture-ready",
    icon: "check"
  },
  IMPORTING: {
    label: "Saving",
    railClassName: "bg-capture-primary",
    icon: "dot"
  },
  IMPORTED: {
    label: "Saved",
    railClassName: "bg-capture-ready",
    icon: "check"
  },
  DISMISSED: {
    label: "Dismissed",
    railClassName: "bg-slate-400",
    icon: "dot"
  }
};

function StatusIcon({ icon }: { icon: "check" | "dot" | "warning" }) {
  if (icon === "check") {
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 20 20"
      >
        <path d="m5 10 3 3 7-7" />
      </svg>
    );
  }

  if (icon === "warning") {
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 20 20"
      >
        <path d="M10 3 2.8 16h14.4L10 3Z" />
        <path d="M10 7v4" />
        <path d="M10 14h.01" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <circle cx="10" cy="10" r="3" />
    </svg>
  );
}

export function StatusRail({ status, issueCount = 0 }: StatusRailProps) {
  const details = statusDetails[status];
  const issueLabel =
    status === "NEEDS_REVIEW" && issueCount > 0
      ? `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`
      : null;
  const accessibleLabel = [details.label, issueLabel].filter(Boolean).join(", ");

  return (
    <div
      aria-label={accessibleLabel}
      className="flex min-h-9 items-center gap-2 font-capture-ui text-xs font-medium text-capture-ink"
      role="status"
    >
      <span
        aria-hidden="true"
        className={`self-stretch rounded-full ${details.railClassName} w-1`}
      />
      <span className="flex items-center gap-1.5">
        <StatusIcon icon={details.icon} />
        <span>{details.label}</span>
        {issueLabel ? <span className="text-slate-600">· {issueLabel}</span> : null}
      </span>
    </div>
  );
}
