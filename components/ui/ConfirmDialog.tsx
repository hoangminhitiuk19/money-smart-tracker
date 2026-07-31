"use client";

type ConfirmDialogProps = {
  confirmAriaLabel?: string;
  confirmLabel?: string;
  description: string;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pendingAriaLabel?: string;
  title: string;
};

export function ConfirmDialog({
  confirmAriaLabel,
  confirmLabel = "Delete",
  description,
  isPending = false,
  onCancel,
  onConfirm,
  pendingAriaLabel,
  title
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <div
        aria-busy={isPending}
        aria-label={title}
        aria-modal="true"
        className="w-full rounded-lg bg-white p-4 shadow-xl md:max-w-sm"
        role="dialog"
      >
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            className="min-h-11 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none md:min-h-0"
            disabled={isPending}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            aria-label={
              isPending
                ? (pendingAriaLabel ?? "Deleting")
                : (confirmAriaLabel ?? confirmLabel)
            }
            className="min-h-11 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-slate-400 motion-reduce:transition-none md:min-h-0"
            disabled={isPending}
            onClick={onConfirm}
            type="button"
          >
            {isPending ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
