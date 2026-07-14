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
      const result = await deleteRenewal(id);

      if (!result.ok) {
        setError(result.error ?? "Unable to delete renewal.");
        return;
      }

      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <button
        className="min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-medium text-expense transition hover:bg-expense/10 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-0"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
        type="button"
      >
        {isPending ? "Deleting..." : "Delete"}
      </button>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      {confirmOpen ? (
        <ConfirmDialog
          description="This renewal will be permanently removed."
          isPending={isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleDelete}
          title="Delete this renewal?"
        />
      ) : null}
    </div>
  );
}
