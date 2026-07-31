"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef
} from "react";

type ConfirmDialogProps = {
  confirmAriaLabel?: string;
  confirmLabel?: string;
  description: string;
  error?: string | null;
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
  error,
  isPending = false,
  onCancel,
  onConfirm,
  pendingAriaLabel,
  title
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusSafestTarget = () => {
      const cancelButton = cancelRef.current;
      if (cancelButton && !cancelButton.disabled) {
        cancelButton.focus();
        return;
      }
      dialogRef.current?.focus();
    };

    focusSafestTarget();

    const keepFocusInside = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (
        dialog &&
        event.target instanceof Node &&
        !dialog.contains(event.target)
      ) {
        focusSafestTarget();
      }
    };

    document.addEventListener("focusin", keepFocusInside);

    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!isPending) {
        onCancel();
      }
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableControls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (element) =>
        element.getAttribute("aria-hidden") !== "true" &&
        !element.hasAttribute("inert")
    );

    event.preventDefault();

    if (focusableControls.length === 0) {
      dialog.focus();
      return;
    }

    const currentIndex = focusableControls.indexOf(
      document.activeElement as HTMLElement
    );
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusableControls.length - 1
        : currentIndex - 1
      : currentIndex === -1 || currentIndex === focusableControls.length - 1
        ? 0
        : currentIndex + 1;

    focusableControls[nextIndex].focus();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <div
        aria-busy={isPending}
        aria-describedby={
          error ? `${descriptionId} ${errorId}` : descriptionId
        }
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full rounded-lg bg-white p-4 shadow-xl md:max-w-sm"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2
          className="text-base font-semibold text-slate-950"
          id={titleId}
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-600" id={descriptionId}>
          {description}
        </p>
        {error ? (
          <p
            className="mt-3 rounded-md border border-expense/20 bg-expense/10 px-3 py-2 text-sm text-expense"
            id={errorId}
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            className="min-h-11 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none md:min-h-0"
            disabled={isPending}
            onClick={onCancel}
            ref={cancelRef}
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
