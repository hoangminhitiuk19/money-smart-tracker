"use client";

import {
  AdjustmentDirection,
  AdjustmentTarget,
  MoneySourceType,
  TransactionType
} from "@prisma/client";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type {
  DraftField,
  TransactionDraftInput,
  TransactionDraftView
} from "@/lib/transaction-drafts/types";

export type DraftPatch = Partial<
  Omit<TransactionDraftInput, "captureKey" | "position" | "origin" | "rawRow">
>;

export type DraftCaptureOption = {
  id: string;
  name: string;
};

export type DraftMoneySourceOption = DraftCaptureOption & {
  type: MoneySourceType;
};

export type DraftExpenseOption = DraftCaptureOption & {
  amount: string;
  transactionDate: string;
};

export type DraftCaptureOptions = {
  categories: readonly DraftCaptureOption[];
  moneySources: readonly DraftMoneySourceOption[];
  projects: readonly DraftCaptureOption[];
  expenses: readonly DraftExpenseOption[];
};

export type DraftSurface = "desktop" | "mobile";

export function draftIsEditable(draft: TransactionDraftView) {
  return draft.status === "NEEDS_REVIEW" || draft.status === "READY";
}

export function draftTypePatch(
  draft: TransactionDraftView,
  type: TransactionType
): DraftPatch {
  const patch: DraftPatch = { type };

  if (type !== TransactionType.EXPENSE && type !== TransactionType.TRANSFER) {
    patch.fromMoneySourceId = null;
  }
  if (
    type !== TransactionType.INCOME &&
    type !== TransactionType.TRANSFER &&
    type !== TransactionType.REFUND
  ) {
    patch.toMoneySourceId = null;
  }
  if (type !== TransactionType.ADJUSTMENT) {
    patch.adjustedMoneySourceId = null;
    patch.adjustmentDirection = null;
    patch.adjustmentTarget = null;
  }
  if (type !== TransactionType.EXPENSE) {
    patch.qualityRating = null;
    patch.countTowardFeeWaiver = false;
  } else if (draft.type !== TransactionType.EXPENSE) {
    patch.countTowardFeeWaiver = false;
  }
  if (type !== TransactionType.REFUND) {
    patch.relatedTransactionId = null;
  }

  return patch;
}

export function draftSourcePatch(
  draft: TransactionDraftView,
  field:
    | "fromMoneySourceId"
    | "toMoneySourceId"
    | "adjustedMoneySourceId",
  value: string | null,
  moneySources: readonly DraftMoneySourceOption[]
): DraftPatch {
  const patch = { [field]: value } as DraftPatch;
  const sourceType = moneySources.find((source) => source.id === value)?.type;

  if (
    draft.type === TransactionType.EXPENSE &&
    field === "fromMoneySourceId" &&
    sourceType !== MoneySourceType.CREDIT_CARD
  ) {
    patch.countTowardFeeWaiver = false;
  }

  return patch;
}

export function draftFieldId(
  surface: DraftSurface,
  draftId: string,
  field: DraftField
) {
  return `${surface}-draft-${draftId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${field}`;
}

type DraftInspectorProps = {
  draft: TransactionDraftView;
  options: DraftCaptureOptions;
  rowNumber: number;
  surface: DraftSurface;
  onChange: (id: string, patch: DraftPatch) => void;
  onPatch: (id: string, patch: DraftPatch) => void;
  onFocusIssue: (id: string, field: DraftField, surface: DraftSurface) => void;
};

function hasIssue(draft: TransactionDraftView, field: DraftField) {
  return draft.issues.some((issue) => issue.field === field);
}

function nullable(value: string) {
  return value || null;
}

export function DraftInspector({
  draft,
  options,
  rowNumber,
  surface,
  onChange,
  onPatch,
  onFocusIssue
}: DraftInspectorProps) {
  const rowLabel = `Row ${rowNumber}`;
  const duplicateVisible = draft.possibleDuplicate || draft.duplicateConfirmed;
  const editable = draftIsEditable(draft);
  const expenseSource = options.moneySources.find(
    (source) => source.id === draft.fromMoneySourceId
  );
  const feeWaiverApplies =
    draft.type === TransactionType.EXPENSE &&
    expenseSource?.type === MoneySourceType.CREDIT_CARD;

  function selectPatch(
    field: keyof DraftPatch,
    value: string
  ) {
    const patch = { [field]: nullable(value) } as DraftPatch;
    onChange(draft.id, patch);
    onPatch(draft.id, patch);
  }

  return (
    <section
      aria-label={`Details for row ${rowNumber}`}
      className="border-t border-slate-200 bg-slate-50/70 px-4 py-4"
      id={`${surface}-draft-${draft.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-inspector`}
      role="region"
      tabIndex={-1}
    >
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(draft.type === TransactionType.INCOME ||
          draft.type === TransactionType.TRANSFER ||
          draft.type === TransactionType.REFUND) ? (
          <label className="min-w-0">
            <span className="text-xs font-semibold text-slate-700">
              Destination
            </span>
            <Select
              aria-invalid={hasIssue(draft, "toMoneySourceId") || undefined}
              aria-label={`${rowLabel} destination`}
              className="mt-1 min-h-11 md:min-h-11"
              disabled={!editable}
              id={draftFieldId(surface, draft.id, "toMoneySourceId")}
              onChange={(event) =>
                selectPatch("toMoneySourceId", event.target.value)
              }
              value={draft.toMoneySourceId ?? ""}
            >
              <option value="">Choose destination</option>
              {options.moneySources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {draft.type === TransactionType.ADJUSTMENT ? (
          <>
            <label className="min-w-0">
              <span className="text-xs font-semibold text-slate-700">
                Adjusted source
              </span>
              <Select
                aria-invalid={
                  hasIssue(draft, "adjustedMoneySourceId") || undefined
                }
                aria-label={`${rowLabel} adjusted source`}
                className="mt-1 min-h-11 md:min-h-11"
                disabled={!editable}
                id={draftFieldId(
                  surface,
                  draft.id,
                  "adjustedMoneySourceId"
                )}
                onChange={(event) =>
                  selectPatch("adjustedMoneySourceId", event.target.value)
                }
                value={draft.adjustedMoneySourceId ?? ""}
              >
                <option value="">Choose source</option>
                {options.moneySources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            </label>

            <label className="min-w-0">
              <span className="text-xs font-semibold text-slate-700">
                Direction
              </span>
              <Select
                aria-invalid={
                  hasIssue(draft, "adjustmentDirection") || undefined
                }
                aria-label={`${rowLabel} adjustment direction`}
                className="mt-1 min-h-11 md:min-h-11"
                disabled={!editable}
                id={draftFieldId(surface, draft.id, "adjustmentDirection")}
                onChange={(event) =>
                  selectPatch("adjustmentDirection", event.target.value)
                }
                value={draft.adjustmentDirection ?? ""}
              >
                <option value="">Choose direction</option>
                <option value={AdjustmentDirection.INCREASE}>Increase</option>
                <option value={AdjustmentDirection.DECREASE}>Decrease</option>
              </Select>
            </label>

            <label className="min-w-0">
              <span className="text-xs font-semibold text-slate-700">
                Adjustment target
              </span>
              <Select
                aria-invalid={hasIssue(draft, "adjustmentTarget") || undefined}
                aria-label={`${rowLabel} adjustment target`}
                className="mt-1 min-h-11 md:min-h-11"
                disabled={!editable}
                id={draftFieldId(surface, draft.id, "adjustmentTarget")}
                onChange={(event) =>
                  selectPatch("adjustmentTarget", event.target.value)
                }
                value={draft.adjustmentTarget ?? ""}
              >
                <option value="">Server default</option>
                <option value={AdjustmentTarget.CREDIT_CARD_DEBT}>
                  Credit card debt
                </option>
                <option value={AdjustmentTarget.CARD_CREDIT}>Card credit</option>
              </Select>
            </label>
          </>
        ) : null}

        {draft.type === TransactionType.REFUND ? (
          <label className="min-w-0">
            <span className="text-xs font-semibold text-slate-700">
              Related expense
            </span>
            <Select
              aria-invalid={
                hasIssue(draft, "relatedTransactionId") || undefined
              }
              aria-label={`${rowLabel} related expense`}
              className="mt-1 min-h-11 md:min-h-11"
              disabled={!editable}
              id={draftFieldId(surface, draft.id, "relatedTransactionId")}
              onChange={(event) =>
                selectPatch("relatedTransactionId", event.target.value)
              }
              value={draft.relatedTransactionId ?? ""}
            >
              <option value="">No linked expense</option>
              {options.expenses.map((expense) => (
                <option key={expense.id} value={expense.id}>
                  {expense.transactionDate} · {expense.name} · {expense.amount}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <label className="min-w-0">
          <span className="text-xs font-semibold text-slate-700">Project</span>
          <Select
            aria-invalid={hasIssue(draft, "projectId") || undefined}
            aria-label={`${rowLabel} project`}
            className="mt-1 min-h-11 md:min-h-11"
            disabled={!editable}
            id={draftFieldId(surface, draft.id, "projectId")}
            onChange={(event) => selectPatch("projectId", event.target.value)}
            value={draft.projectId ?? ""}
          >
            <option value="">No project</option>
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="min-w-0 md:col-span-2">
          <span className="text-xs font-semibold text-slate-700">
            Description
          </span>
          <Input
            aria-invalid={hasIssue(draft, "description") || undefined}
            aria-label={`${rowLabel} description`}
            className="mt-1 min-h-11 md:min-h-11"
            disabled={!editable}
            id={draftFieldId(surface, draft.id, "description")}
            onBlur={() =>
              onPatch(draft.id, { description: draft.description })
            }
            onChange={(event) =>
              onChange(draft.id, { description: event.target.value || null })
            }
            value={draft.description ?? ""}
          />
        </label>

        {feeWaiverApplies ? (
          <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-capture-ink md:col-span-2 xl:col-span-1">
            <input
              aria-label={`${rowLabel} count toward fee waiver`}
              checked={draft.countTowardFeeWaiver === true}
              className="h-4 w-4 accent-capture-primary"
              disabled={!editable}
              id={draftFieldId(surface, draft.id, "countTowardFeeWaiver")}
              onChange={(event) => {
                const patch = { countTowardFeeWaiver: event.target.checked };
                onChange(draft.id, patch);
                onPatch(draft.id, patch);
              }}
              type="checkbox"
            />
            Count toward fee waiver
          </label>
        ) : null}
      </div>

      {duplicateVisible ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950">
          <p className="font-semibold">
            {draft.duplicateConfirmed
              ? "Possible duplicate · acknowledged"
              : "Possible duplicate"}
          </p>
          <label className="mt-2 flex min-h-11 items-center gap-2">
            <input
              aria-label={`Keep row ${rowNumber} as a separate transaction`}
              checked={draft.duplicateConfirmed}
              className="h-4 w-4 accent-capture-primary"
              disabled={!editable}
              id={draftFieldId(surface, draft.id, "duplicateConfirmed")}
              onChange={(event) => {
                const patch = { duplicateConfirmed: event.target.checked };
                onChange(draft.id, patch);
                onPatch(draft.id, patch);
              }}
              type="checkbox"
            />
            Keep as a separate transaction
          </label>
        </div>
      ) : null}

      {draft.issues.length > 0 ? (
        <div className="mt-4" aria-label={`Findings for row ${rowNumber}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-capture-review">
            Review findings
          </p>
          <ul className="mt-2 space-y-1.5">
            {draft.issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                <button
                  className="min-h-11 text-left text-sm font-medium text-capture-error underline decoration-capture-error/30 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary"
                  onClick={() =>
                    onFocusIssue(draft.id, issue.field, surface)
                  }
                  type="button"
                >
                  {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
