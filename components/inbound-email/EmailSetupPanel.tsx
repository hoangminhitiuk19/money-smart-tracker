"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  createInboundMailbox,
  deletePendingInboundEmailDrafts,
  disableInboundMailbox,
  disconnectInboundMailbox,
  enableInboundMailbox,
  rotateInboundMailbox,
  type InboundEmailActionResult,
  type InboundEmailSetupView
} from "@/lib/actions/inbound-email";

const safetyNotice =
  "Testing only — use synthetic or redacted information. Money Smart Tracker cannot browse your mailbox; it receives only messages sent to this private address. Resend may retain received email for up to 30 days.";

const syntheticFixture = `MONEY SMART TRACKER TEST
Amount: 125000
Currency: VND
Date: 2026-08-10
Merchant: Demo Cafe`;

const captureKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DialogKind = "rotate" | "enable" | "disable" | "delete" | "disconnect";

type DialogDetails = {
  confirmLabel: string;
  description: string;
  pendingLabel: string;
  title: string;
};

const dialogs: Record<DialogKind, DialogDetails> = {
  rotate: {
    title: "Rotate the test address?",
    description:
      "The current address will stop accepting messages immediately. Pending test drafts stay available.",
    confirmLabel: "Rotate address",
    pendingLabel: "Rotating address"
  },
  enable: {
    title: "Enable email forwarding?",
    description:
      "New synthetic or redacted messages sent to this address will be accepted for review.",
    confirmLabel: "Enable forwarding",
    pendingLabel: "Enabling forwarding"
  },
  disable: {
    title: "Disable email forwarding?",
    description:
      "New messages will be ignored until email forwarding is enabled again. Pending test drafts stay available.",
    confirmLabel: "Disable forwarding",
    pendingLabel: "Disabling forwarding"
  },
  delete: {
    title: "Delete pending test drafts?",
    description:
      "All pending email test drafts will be permanently deleted. Your forwarding address stays active.",
    confirmLabel: "Delete pending drafts",
    pendingLabel: "Deleting pending drafts"
  },
  disconnect: {
    title: "Disconnect email forwarding?",
    description:
      "The test address will stop working and all pending email test drafts will be permanently deleted.",
    confirmLabel: "Disconnect email",
    pendingLabel: "Disconnecting email"
  }
};

const dispositionDetails: Record<
  NonNullable<InboundEmailSetupView["mailbox"]>["lastDisposition"] & string,
  { label: string; detail: string; mark: string }
> = {
  TEST_DRAFT_CREATED: {
    label: "Received",
    detail: "A synthetic test draft is ready for your review.",
    mark: "✓"
  },
  DUPLICATE: {
    label: "Duplicate",
    detail: "The repeated message was ignored; no second draft was created.",
    mark: "="
  },
  UNSUPPORTED: {
    label: "Unsupported",
    detail: "The message did not match the synthetic test format, so no draft was created.",
    mark: "?"
  },
  OVERSIZED: {
    label: "Rejected",
    detail: "The message exceeded the testing limit, so no draft was created.",
    mark: "!"
  },
  PARSER_ERROR: {
    label: "Rejected",
    detail: "The message could not be safely parsed, so no draft was created.",
    mark: "!"
  },
  RATE_LIMITED: {
    label: "Delayed",
    detail: "Testing is temporarily limited. Wait before forwarding another message.",
    mark: "…"
  },
  PROVIDER_ERROR: {
    label: "Delayed",
    detail: "Delivery could not finish. The provider may retry the message.",
    mark: "…"
  }
};

function safeActionError(error: string, address: string | null) {
  const containsAddress = address ? error.includes(address) : false;
  const containsEmailLikeValue = /\b[^\s@]+@[^\s@]+\b/.test(error);

  return containsAddress || containsEmailLikeValue
    ? "Unable to update inbound email settings."
    : error;
}

function StatusMark({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold"
    >
      {children}
    </span>
  );
}

function statusFor(setup: InboundEmailSetupView) {
  if (!setup.configured) {
    return {
      label: "Not configured",
      detail: "Inbound email testing is not connected in this environment.",
      mark: "!"
    };
  }

  if (!setup.mailbox) {
    return {
      label: "Not connected",
      detail: "Create a private test address when you are ready to try forwarding.",
      mark: "+"
    };
  }

  if (!setup.mailbox.lastDisposition) {
    return {
      label: "Waiting",
      detail:
        setup.mailbox.status === "ACTIVE"
          ? "Send the synthetic fixture to the private address, then return here."
          : "Enable forwarding before sending another synthetic test message.",
      mark: "…"
    };
  }

  return dispositionDetails[setup.mailbox.lastDisposition] ?? {
    label: "Rejected",
    detail: "No draft was created from the last test message.",
    mark: "!"
  };
}

export function EmailSetupPanel({
  initialSetup
}: {
  initialSetup: InboundEmailSetupView;
}) {
  const [setup, setSetup] = useState(initialSetup);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [focusVersion, setFocusVersion] = useState(0);
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const mailbox = setup.mailbox;
  const currentStatus = statusFor(setup);
  const reviewCaptureKey =
    mailbox?.reviewCaptureKey &&
    captureKeyPattern.test(mailbox.reviewCaptureKey)
      ? mailbox.reviewCaptureKey
      : null;

  useEffect(() => {
    if (focusVersion > 0 && dialog === null) {
      statusHeadingRef.current?.focus();
    }
  }, [dialog, focusVersion]);

  async function copyText(text: string, confirmation: string) {
    try {
      await navigator.clipboard.writeText(text);
      setLiveMessage(confirmation);
    } catch {
      setLiveMessage("Unable to copy. Select and copy the text manually.");
    }
  }

  async function createAddress() {
    if (isCreating) {
      return;
    }

    setIsCreating(true);
    setLiveMessage("");
    try {
      const result = await createInboundMailbox();
      if (result.ok) {
        setSetup(result.setup);
        setLiveMessage("Test address created.");
        setFocusVersion((version) => version + 1);
      } else {
        setLiveMessage(safeActionError(result.error, mailbox?.address ?? null));
      }
    } catch {
      setLiveMessage("Unable to create a test address. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  function openDialog(kind: DialogKind) {
    setDialogError(null);
    setDialog(kind);
  }

  async function runSetupAction(
    action: () => Promise<InboundEmailActionResult<{ setup: InboundEmailSetupView }>>,
    successMessage: string
  ) {
    const result = await action();
    if (!result.ok) {
      return result;
    }

    setSetup(result.setup);
    setLiveMessage(successMessage);
    return result;
  }

  async function confirmAction() {
    if (!dialog || isPending) {
      return;
    }

    setIsPending(true);
    setDialogError(null);

    try {
      let result: { ok: boolean; error?: string };

      if (dialog === "rotate") {
        result = await runSetupAction(
          rotateInboundMailbox,
          "Test address rotated. The previous address no longer works."
        );
      } else if (dialog === "enable") {
        result = await runSetupAction(
          enableInboundMailbox,
          "Email forwarding enabled."
        );
      } else if (dialog === "disable") {
        result = await runSetupAction(
          disableInboundMailbox,
          "Email forwarding disabled."
        );
      } else if (dialog === "delete") {
        const deletion = await deletePendingInboundEmailDrafts();
        result = deletion;
        if (deletion.ok) {
          setSetup(deletion.setup);
          setLiveMessage(
            `Deleted ${deletion.deletedCount} pending test ${
              deletion.deletedCount === 1 ? "draft" : "drafts"
            }.`
          );
        }
      } else {
        const disconnection = await disconnectInboundMailbox();
        result = disconnection;
        if (disconnection.ok) {
          setSetup({ configured: setup.configured, mailbox: null });
          setLiveMessage(
            `Email forwarding disconnected. Deleted ${disconnection.deletedDraftCount} pending test ${
              disconnection.deletedDraftCount === 1 ? "draft" : "drafts"
            }.`
          );
        }
      }

      if (!result.ok) {
        setDialogError(
          safeActionError(
            result.error ?? "Unable to update inbound email settings.",
            mailbox?.address ?? null
          )
        );
        return;
      }

      setDialog(null);
      setFocusVersion((version) => version + 1);
    } catch {
      setDialogError("Unable to update inbound email settings. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  const dialogDetails = dialog ? dialogs[dialog] : null;

  return (
    <div className="min-w-0 space-y-5">
        <aside className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
          <p className="font-semibold">{safetyNotice}</p>
        </aside>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="min-w-0 space-y-5">
            <Card className="min-w-0" title="Private test address">
              <div className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50/70 p-4">
                <StatusMark>
                  {mailbox
                    ? mailbox.status === "DISABLED"
                      ? "×"
                      : "✓"
                    : setup.configured
                      ? "+"
                      : "!"}
                </StatusMark>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-950">
                    {mailbox
                      ? mailbox.status === "ACTIVE"
                        ? "Active"
                        : "Disabled"
                      : setup.configured
                        ? "No address yet"
                        : "Service unavailable"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    This address receives only messages explicitly sent to it. It does not grant mailbox access.
                  </p>
                </div>
              </div>

              {mailbox?.address ? (
                <div className="mt-4 min-w-0 rounded-xl border-2 border-capture-primary bg-white p-4 shadow-sm">
                  <p className="font-capture-data text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-capture-primary">
                    Forward synthetic tests here
                  </p>
                  <code className="mt-2 block min-w-0 break-all font-capture-data text-sm font-semibold text-capture-ink">
                    {mailbox.address}
                  </code>
                  <Button
                    aria-label="Copy test address"
                    className="mt-4 motion-reduce:transition-none"
                    onClick={() => copyText(mailbox.address ?? "", "Test address copied.")}
                    variant="outline"
                  >
                    Copy test address
                  </Button>
                </div>
              ) : setup.configured ? (
                <Button
                  className="mt-4 motion-reduce:transition-none"
                  disabled={isCreating}
                  onClick={createAddress}
                >
                  {isCreating ? "Creating test address" : "Create test address"}
                </Button>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Inbound email testing is not connected. No provider call will be made.
                </p>
              )}
            </Card>

            <section
              aria-labelledby="synthetic-test-message-heading"
              className="min-w-0 border-y border-slate-200 py-5 sm:px-1"
            >
              <h2
                className="font-capture-display text-lg font-semibold text-slate-950"
                id="synthetic-test-message-heading"
              >
                Synthetic test message
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Send this fixture exactly as shown. Other content is rejected and never guessed into a transaction.
              </p>
              <pre className="mt-4 min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-950 p-4 font-capture-data text-xs leading-6 text-slate-100">
                {syntheticFixture}
              </pre>
              <Button
                aria-label="Copy synthetic test message"
                className="mt-4 motion-reduce:transition-none"
                onClick={() =>
                  copyText(syntheticFixture, "Synthetic test message copied.")
                }
                variant="outline"
              >
                Copy test message
              </Button>
            </section>
          </div>

          <div className="min-w-0 space-y-5">
            <section
              aria-labelledby="delivery-status-heading"
              className="min-w-0 border-b border-slate-200 pb-5"
            >
              <h2
                className="font-capture-display text-lg font-semibold text-slate-950"
                id="delivery-status-heading"
              >
                Delivery status
              </h2>
              <div className="mt-4 flex items-start gap-3">
                <StatusMark>{currentStatus.mark}</StatusMark>
                <div className="min-w-0">
                  <h3
                    className="font-capture-display text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary"
                    ref={statusHeadingRef}
                    tabIndex={-1}
                  >
                    {currentStatus.label}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {currentStatus.detail}
                  </p>
                </div>
              </div>

              {mailbox?.lastReceivedAt ? (
                <p className="mt-4 font-capture-data text-xs text-slate-500">
                  Last safe receipt update: {mailbox.lastReceivedAt}
                </p>
              ) : null}

              {reviewCaptureKey ? (
                <Link
                  className="mt-4 inline-flex min-h-11 items-center rounded-md bg-capture-primary px-4 text-sm font-semibold text-white transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary"
                  href={`/transactions/capture?capture=${reviewCaptureKey}`}
                >
                  Review test draft
                </Link>
              ) : null}
            </section>

            {mailbox ? (
              <section
                aria-labelledby="testing-controls-heading"
                className="min-w-0"
              >
                <h2
                  className="font-capture-display text-lg font-semibold text-slate-950"
                  id="testing-controls-heading"
                >
                  Testing controls
                </h2>
                <div className="mt-3 grid gap-2">
                  <Button
                    className="w-full motion-reduce:transition-none"
                    onClick={() => openDialog("rotate")}
                    variant="outline"
                  >
                    Rotate test address
                  </Button>
                  <Button
                    className="w-full motion-reduce:transition-none"
                    onClick={() =>
                      openDialog(mailbox.status === "ACTIVE" ? "disable" : "enable")
                    }
                    variant="outline"
                  >
                    {mailbox.status === "ACTIVE"
                      ? "Disable email forwarding"
                      : "Enable email forwarding"}
                  </Button>
                  <Button
                    className="w-full motion-reduce:transition-none"
                    onClick={() => openDialog("delete")}
                    variant="outline"
                  >
                    Delete pending test drafts
                  </Button>
                  <Button
                    className="w-full motion-reduce:transition-none"
                    onClick={() => openDialog("disconnect")}
                    variant="danger"
                  >
                    Disconnect email forwarding
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        {liveMessage ? (
          <p
            aria-live="polite"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            role="status"
          >
            {liveMessage}
          </p>
        ) : null}
      {dialogDetails ? (
        <ConfirmDialog
          confirmLabel={dialogDetails.confirmLabel}
          description={dialogDetails.description}
          error={dialogError}
          isPending={isPending}
          onCancel={() => {
            if (!isPending) {
              setDialogError(null);
              setDialog(null);
            }
          }}
          onConfirm={confirmAction}
          pendingAriaLabel={dialogDetails.pendingLabel}
          pendingLabel={dialogDetails.pendingLabel}
          title={dialogDetails.title}
        />
      ) : null}
    </div>
  );
}
