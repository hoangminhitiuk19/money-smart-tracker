"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type DestructiveActionResult = {
  error?: string;
  ok: boolean;
};

type DestructiveActionButtonProps = {
  action: () => Promise<void | DestructiveActionResult>;
  description: string;
  itemLabel: string;
  title: string;
};

export function DestructiveActionButton({
  action,
  description,
  itemLabel,
  title
}: DestructiveActionButtonProps) {
  const inFlight = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setError(null);
    setIsPending(true);

    try {
      const result = await action();
      if (result && !result.ok) {
        setError(result.error ?? "Unable to delete this item. Please try again.");
        return;
      }
      setConfirmOpen(false);
    } catch {
      setError("Unable to delete this item. Please try again.");
    } finally {
      inFlight.current = false;
      setIsPending(false);
    }
  }

  function handleCancel() {
    if (isPending) {
      return;
    }
    setError(null);
    setConfirmOpen(false);
  }

  function handleOpen() {
    setError(null);
    setConfirmOpen(true);
  }

  return (
    <>
      <Button
        aria-label={`Delete ${itemLabel}`}
        disabled={isPending}
        onClick={handleOpen}
        size="sm"
        variant="danger"
      >
        Delete
      </Button>
      {confirmOpen ? (
        <ConfirmDialog
          confirmAriaLabel={`Delete ${itemLabel} permanently`}
          description={description}
          error={error}
          isPending={isPending}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          pendingAriaLabel={`Deleting ${itemLabel}`}
          title={title}
        />
      ) : null}
    </>
  );
}
