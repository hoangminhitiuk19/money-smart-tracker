"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type DestructiveActionButtonProps = {
  action: () => Promise<void>;
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
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setIsPending(true);

    try {
      await action();
      setConfirmOpen(false);
    } finally {
      inFlight.current = false;
      setIsPending(false);
    }
  }

  return (
    <>
      <Button
        aria-label={`Delete ${itemLabel}`}
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
        size="sm"
        variant="danger"
      >
        Delete
      </Button>
      {confirmOpen ? (
        <ConfirmDialog
          confirmAriaLabel={`Delete ${itemLabel} permanently`}
          description={description}
          isPending={isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirm}
          pendingAriaLabel={`Deleting ${itemLabel}`}
          title={title}
        />
      ) : null}
    </>
  );
}
