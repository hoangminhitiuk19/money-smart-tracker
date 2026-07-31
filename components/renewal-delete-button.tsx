"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteRenewal } from "@/lib/actions/renewals";

type RenewalDeleteButtonProps = {
  id: string;
};

export function RenewalDeleteButton({ id }: RenewalDeleteButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteRenewal(id);

        if (!result.ok) {
          setError(result.error ?? "Unable to delete renewal.");
          return;
        }

        setConfirmOpen(false);
        router.refresh();
      } catch {
        setError("Unable to delete renewal. Please try again.");
      }
    });
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
    <div>
      <button
        className="min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-medium text-expense transition hover:bg-expense/10 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-0"
        disabled={isPending}
        onClick={handleOpen}
        type="button"
      >
        {isPending ? "Deleting..." : "Delete"}
      </button>
      {confirmOpen ? (
        <ConfirmDialog
          description="This renewal will be permanently removed."
          error={error}
          isPending={isPending}
          onCancel={handleCancel}
          onConfirm={handleDelete}
          title="Delete this renewal?"
        />
      ) : null}
    </div>
  );
}
