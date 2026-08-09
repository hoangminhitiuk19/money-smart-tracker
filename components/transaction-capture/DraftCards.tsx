"use client";

import { QualityRating, TransactionType } from "@prisma/client";
import { useState, type ClipboardEvent } from "react";
import {
  DraftInspector,
  draftIsEditable,
  draftSourcePatch,
  draftTypePatch,
  draftFieldId,
  type DraftCaptureOptions,
  type DraftPatch
} from "@/components/transaction-capture/DraftInspector";
import type { PasteableDraftField } from "@/components/transaction-capture/DraftLedger";
import { OriginStamp } from "@/components/transaction-capture/OriginStamp";
import { StatusRail } from "@/components/transaction-capture/StatusRail";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { DraftField, TransactionDraftView } from "@/lib/transaction-drafts/types";

type DraftCardsProps = {
  drafts: readonly TransactionDraftView[];
  options: DraftCaptureOptions;
  selectedIds: ReadonlySet<string>;
  onChange: (id: string, patch: DraftPatch) => void;
  onPatch: (id: string, patch: DraftPatch) => void;
  onSelectionChange: (ids: ReadonlySet<string>) => void;
  onCellPaste: (id: string, field: PasteableDraftField, text: string) => void;
  onFocusIssue: (id: string, field: DraftField, surface: "desktop" | "mobile") => void;
};

const transactionTypes = Object.values(TransactionType);
const qualityRatings = Object.values(QualityRating);

function sourceField(draft: TransactionDraftView) {
  if (
    draft.type === TransactionType.INCOME ||
    draft.type === TransactionType.REFUND
  ) {
    return "toMoneySourceId" as const;
  }
  if (draft.type === TransactionType.ADJUSTMENT) {
    return "adjustedMoneySourceId" as const;
  }
  return "fromMoneySourceId" as const;
}

function hasIssue(draft: TransactionDraftView, field: DraftField) {
  return draft.issues.some((issue) => issue.field === field);
}

export function DraftCards({
  drafts,
  options,
  selectedIds,
  onChange,
  onPatch,
  onSelectionChange,
  onCellPaste,
  onFocusIssue
}: DraftCardsProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  function toggleSelection(id: string, selected: boolean) {
    const next = new Set(selectedIds);
    if (selected) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pasteCell(
    event: ClipboardEvent<HTMLInputElement>,
    id: string,
    field: PasteableDraftField
  ) {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n") && !text.includes("\r") && selectedIds.size <= 1) {
      return;
    }
    event.preventDefault();
    onCellPaste(id, field, text);
  }

  return (
    <div
      className="mt-3 min-w-0 space-y-3 lg:hidden"
      data-testid="capture-mobile-cards"
    >
      {drafts.map((draft, index) => {
        const rowNumber = index + 1;
        const expanded = expandedIds.has(draft.id);
        const editable = draftIsEditable(draft);
        const source = sourceField(draft);

        return (
          <article
            aria-label={`Transaction draft row ${rowNumber}`}
            className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white transition-[opacity,transform] duration-200 motion-reduce:transition-none"
            id={`mobile-draft-${draft.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
            key={draft.id}
            tabIndex={-1}
          >
            <div className="p-4">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <StatusRail issueCount={draft.issues.length} status={draft.status} />
                  <div className="mt-2"><OriginStamp origin={draft.origin} /></div>
                </div>
                <label className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-200">
                  <input
                    aria-label={`Select row ${rowNumber}`}
                    checked={selectedIds.has(draft.id)}
                    className="h-4 w-4 accent-capture-primary"
                    disabled={!editable}
                    onChange={(event) => toggleSelection(draft.id, event.target.checked)}
                    type="checkbox"
                  />
                </label>
              </div>
              <div className="mt-4 flex min-w-0 items-end justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-capture-display text-base font-semibold text-capture-ink">
                    {draft.title || `Untitled row ${rowNumber}`}
                  </h3>
                  <p className="mt-1 font-capture-data text-xs text-slate-500">
                    {draft.transactionDateText || "Date needed"} · {draft.type || "Type needed"}
                  </p>
                </div>
                <p className="shrink-0 font-capture-data text-base font-semibold text-capture-ink">
                  {draft.amountText || "—"} <span className="text-xs text-slate-500">{draft.currency}</span>
                </p>
              </div>
              <button
                aria-controls={`mobile-editor-${draft.id}`}
                aria-expanded={expanded}
                aria-label={`Edit row ${rowNumber}`}
                className="mt-4 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-capture-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary"
                onClick={() => toggleExpanded(draft.id)}
                type="button"
              >
                {expanded ? "Close editor" : "Edit row"}
              </button>
            </div>

            {expanded ? (
              <div className="border-t border-slate-200" id={`mobile-editor-${draft.id}`}>
                <div className="grid min-w-0 gap-4 p-4">
                  <label className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">Date</span>
                    <Input
                      aria-invalid={hasIssue(draft, "transactionDateText") || undefined}
                      aria-label={`Row ${rowNumber} date`}
                      className="mt-1 min-h-11 font-capture-data md:min-h-11"
                      disabled={!editable}
                      id={draftFieldId("mobile", draft.id, "transactionDateText")}
                      onBlur={() => onPatch(draft.id, { transactionDateText: draft.transactionDateText })}
                      onChange={(event) => onChange(draft.id, { transactionDateText: event.target.value || null })}
                      onPaste={(event) => pasteCell(event, draft.id, "transactionDateText")}
                      value={draft.transactionDateText ?? ""}
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">Type</span>
                    <Select
                      aria-invalid={hasIssue(draft, "type") || undefined}
                      aria-label={`Row ${rowNumber} type`}
                      className="mt-1 min-h-11 md:min-h-11"
                      disabled={!editable}
                      id={draftFieldId("mobile", draft.id, "type")}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        const patch = draftTypePatch(
                          draft,
                          event.target.value as TransactionType
                        );
                        onChange(draft.id, patch);
                        onPatch(draft.id, patch);
                      }}
                      value={draft.type ?? ""}
                    >
                      {draft.type === null ? (
                        <option value="">Choose type</option>
                      ) : null}
                      {transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                    </Select>
                  </label>
                  <label className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">Title</span>
                    <Input
                      aria-invalid={hasIssue(draft, "title") || undefined}
                      aria-label={`Row ${rowNumber} title`}
                      className="mt-1 min-h-11 md:min-h-11"
                      disabled={!editable}
                      id={draftFieldId("mobile", draft.id, "title")}
                      onBlur={() => onPatch(draft.id, { title: draft.title })}
                      onChange={(event) => onChange(draft.id, { title: event.target.value || null })}
                      onPaste={(event) => pasteCell(event, draft.id, "title")}
                      value={draft.title ?? ""}
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">Amount</span>
                    <Input
                      aria-invalid={hasIssue(draft, "amountText") || undefined}
                      aria-label={`Row ${rowNumber} amount`}
                      className="mt-1 min-h-11 font-capture-data md:min-h-11"
                      disabled={!editable}
                      id={draftFieldId("mobile", draft.id, "amountText")}
                      inputMode="decimal"
                      onBlur={() => onPatch(draft.id, { amountText: draft.amountText })}
                      onChange={(event) => onChange(draft.id, { amountText: event.target.value || null })}
                      onPaste={(event) => pasteCell(event, draft.id, "amountText")}
                      value={draft.amountText ?? ""}
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">Source</span>
                    <Select
                      aria-invalid={hasIssue(draft, source) || undefined}
                      aria-label={`Row ${rowNumber} source`}
                      className="mt-1 min-h-11 md:min-h-11"
                      disabled={!editable}
                      id={draftFieldId("mobile", draft.id, source)}
                      onChange={(event) => {
                        const patch = draftSourcePatch(
                          draft,
                          source,
                          event.target.value || null
                        );
                        onChange(draft.id, patch);
                        onPatch(draft.id, patch);
                      }}
                      value={draft[source] ?? ""}
                    >
                      <option value="">Choose source</option>
                      {options.moneySources.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </Select>
                  </label>
                  <label className="min-w-0">
                    <span className="text-xs font-semibold text-slate-700">Category</span>
                    <Select
                      aria-invalid={hasIssue(draft, "categoryId") || undefined}
                      aria-label={`Row ${rowNumber} category`}
                      className="mt-1 min-h-11 md:min-h-11"
                      disabled={!editable}
                      id={draftFieldId("mobile", draft.id, "categoryId")}
                      onChange={(event) => {
                        const patch = { categoryId: event.target.value || null };
                        onChange(draft.id, patch);
                        onPatch(draft.id, patch);
                      }}
                      value={draft.categoryId ?? ""}
                    >
                      <option value="">No category</option>
                      {options.categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </Select>
                  </label>
                  {draft.type === TransactionType.EXPENSE ? (
                    <label className="min-w-0">
                      <span className="text-xs font-semibold text-slate-700">Quality</span>
                      <Select
                        aria-invalid={hasIssue(draft, "qualityRating") || undefined}
                        aria-label={`Row ${rowNumber} quality`}
                        className="mt-1 min-h-11 md:min-h-11"
                        disabled={!editable}
                        id={draftFieldId("mobile", draft.id, "qualityRating")}
                        onChange={(event) => {
                          const patch = {
                            qualityRating: (event.target.value || null) as QualityRating | null,
                            qualityRatingTouched: true
                          };
                          onChange(draft.id, patch);
                          onPatch(draft.id, patch);
                        }}
                        value={draft.qualityRating ?? ""}
                      >
                        <option value="">No rating</option>
                        {qualityRatings.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                      </Select>
                    </label>
                  ) : null}
                </div>
                <DraftInspector
                  draft={draft}
                  onChange={onChange}
                  onFocusIssue={onFocusIssue}
                  onPatch={onPatch}
                  options={options}
                  rowNumber={rowNumber}
                  surface="mobile"
                />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
