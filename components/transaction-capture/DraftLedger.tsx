"use client";

import {
  QualityRating,
  TransactionType
} from "@prisma/client";
import {
  Fragment,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent
} from "react";
import {
  DraftInspector,
  draftIsEditable,
  draftSourcePatch,
  draftTypePatch,
  draftFieldId,
  type DraftCaptureOptions,
  type DraftPatch
} from "@/components/transaction-capture/DraftInspector";
import { OriginStamp } from "@/components/transaction-capture/OriginStamp";
import { StatusRail } from "@/components/transaction-capture/StatusRail";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type {
  DraftField,
  TransactionDraftView
} from "@/lib/transaction-drafts/types";

export type FillableDraftField =
  | "transactionDateText"
  | "type"
  | "title"
  | "amountText"
  | "source"
  | "categoryId"
  | "qualityRating";

export type PasteableDraftField = Extract<
  FillableDraftField,
  "transactionDateText" | "title" | "amountText"
>;

type DraftLedgerProps = {
  drafts: readonly TransactionDraftView[];
  options: DraftCaptureOptions;
  selectedIds: ReadonlySet<string>;
  onChange: (id: string, patch: DraftPatch) => void;
  onPatch: (id: string, patch: DraftPatch) => void;
  onSelectionChange: (ids: ReadonlySet<string>) => void;
  onCellPaste: (
    id: string,
    field: PasteableDraftField,
    clipboardText: string
  ) => void;
  onFocusIssue: (id: string, field: DraftField, surface: "desktop" | "mobile") => void;
};

const transactionTypes = Object.values(TransactionType);
const qualityRatings = Object.values(QualityRating);

const fillableFields: readonly { value: FillableDraftField; label: string }[] = [
  { value: "transactionDateText", label: "Date" },
  { value: "type", label: "Type" },
  { value: "title", label: "Title" },
  { value: "amountText", label: "Amount" },
  { value: "source", label: "Source" },
  { value: "categoryId", label: "Category" },
  { value: "qualityRating", label: "Quality" }
];

const focusOrder: readonly FillableDraftField[] = [
  "transactionDateText",
  "type",
  "title",
  "amountText",
  "source",
  "categoryId",
  "qualityRating"
];

function issueFor(draft: TransactionDraftView, field: DraftField) {
  return draft.issues.find((issue) => issue.field === field)?.message;
}

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

type DraftFillToolbarProps = {
  busy: boolean;
  field: FillableDraftField;
  selectedCount: number;
  onFieldChange: (field: FillableDraftField) => void;
  onFillDown: (field: FillableDraftField) => void;
};

export function DraftFillToolbar({
  busy,
  field,
  selectedCount,
  onFieldChange,
  onFillDown
}: DraftFillToolbarProps) {
  return (
    <div
      aria-label="Fill selected draft rows"
      className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-end"
      role="group"
    >
      <label className="min-w-0 flex-1 sm:max-w-56">
        <span className="block text-xs font-semibold text-slate-600">
          Field to fill down
        </span>
        <Select
          aria-label="Field to fill down"
          className="mt-1 min-h-11 md:min-h-11"
          onChange={(event) =>
            onFieldChange(event.target.value as FillableDraftField)
          }
          value={field}
        >
          {fillableFields.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <button
        className="min-h-11 rounded-md bg-capture-primary px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || selectedCount < 2}
        onClick={() => onFillDown(field)}
        type="button"
      >
        Fill selected rows
      </button>
      <p className="text-xs leading-5 text-slate-500 sm:max-w-xs">
        Select at least two rows. The first selected row supplies the value.
      </p>
    </div>
  );
}

export function DraftLedger({
  drafts,
  options,
  selectedIds,
  onChange,
  onPatch,
  onSelectionChange,
  onCellPaste,
  onFocusIssue
}: DraftLedgerProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const controls = useRef(new Map<string, HTMLElement>());

  function setControl(id: string, field: FillableDraftField, node: HTMLElement | null) {
    const key = `${id}:${field}`;
    if (node) controls.current.set(key, node);
    else controls.current.delete(key);
  }

  function toggleSelection(id: string, selected: boolean) {
    const next = new Set(selectedIds);
    if (selected) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  }

  function navigateTextCell(
    event: KeyboardEvent<HTMLInputElement>,
    draftId: string,
    field: FillableDraftField
  ) {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    ) {
      return;
    }

    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start === null || end === null || start !== end) return;

    const direction = event.key === "ArrowRight" ? 1 : -1;
    const atBoundary = direction === 1 ? end === input.value.length : start === 0;
    if (!atBoundary) return;

    const index = focusOrder.indexOf(field);
    const nextField = focusOrder[index + direction];
    const nextControl = nextField
      ? controls.current.get(`${draftId}:${nextField}`)
      : null;
    if (!nextControl) return;

    event.preventDefault();
    nextControl.focus();
  }

  function pasteCell(
    event: ClipboardEvent<HTMLInputElement>,
    draftId: string,
    field: PasteableDraftField
  ) {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n") && !text.includes("\r") && selectedIds.size <= 1) {
      return;
    }
    event.preventDefault();
    onCellPaste(draftId, field, text);
  }

  function setExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="mt-3 hidden min-w-0 rounded-xl border border-slate-200 bg-white lg:block"
      data-testid="capture-desktop-ledger"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[78rem] border-collapse" aria-label="Transaction drafts">
          <thead className="bg-slate-50 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="w-12 px-2 py-2" scope="col">
                <span className="sr-only">Select</span>
              </th>
              <th className="w-36 px-2 py-2" scope="col">Status</th>
              <th className="w-20 px-2 py-2" scope="col">Origin</th>
              <th className="w-36 px-2 py-2" scope="col">Date</th>
              <th className="w-36 px-2 py-2" scope="col">Type</th>
              <th className="min-w-48 px-2 py-2" scope="col">Title</th>
              <th className="w-44 px-2 py-2" scope="col">Amount</th>
              <th className="w-48 px-2 py-2" scope="col">Source</th>
              <th className="w-44 px-2 py-2" scope="col">Category</th>
              <th className="w-28 px-2 py-2" scope="col">Quality</th>
              <th className="w-24 px-2 py-2" scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft, index) => {
              const rowNumber = index + 1;
              const expanded = expandedIds.has(draft.id);
              const editable = draftIsEditable(draft);
              const source = sourceField(draft);
              const sourceIssue = issueFor(draft, source);

              return (
                <Fragment key={draft.id}>
                  <tr
                    aria-selected={selectedIds.has(draft.id)}
                    className="align-top transition-[opacity,transform] duration-200 motion-reduce:transition-none aria-selected:bg-indigo-50/60"
                  >
                    <td className="px-2 py-2">
                      <label className="flex min-h-11 min-w-11 items-center justify-center">
                        <input
                          aria-label={`Select row ${rowNumber}`}
                          checked={selectedIds.has(draft.id)}
                          className="h-4 w-4 accent-capture-primary"
                          disabled={!editable}
                          onChange={(event) =>
                            toggleSelection(draft.id, event.target.checked)
                          }
                          type="checkbox"
                        />
                      </label>
                    </td>
                    <td className="px-2 py-2">
                      <StatusRail
                        issueCount={draft.issues.length}
                        status={draft.status}
                      />
                    </td>
                    <td className="px-2 py-3"><OriginStamp origin={draft.origin} /></td>
                    <td className="px-2 py-2">
                      <Input
                        aria-invalid={issueFor(draft, "transactionDateText") ? true : undefined}
                        aria-label={`Row ${rowNumber} date`}
                        className="min-h-11 font-capture-data md:min-h-11"
                        disabled={!editable}
                        id={draftFieldId("desktop", draft.id, "transactionDateText")}
                        onBlur={() => onPatch(draft.id, { transactionDateText: draft.transactionDateText })}
                        onChange={(event) => onChange(draft.id, { transactionDateText: event.target.value || null })}
                        onKeyDown={(event) => navigateTextCell(event, draft.id, "transactionDateText")}
                        onPaste={(event) => pasteCell(event, draft.id, "transactionDateText")}
                        ref={(node) => setControl(draft.id, "transactionDateText", node)}
                        type="text"
                        value={draft.transactionDateText ?? ""}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        aria-invalid={issueFor(draft, "type") ? true : undefined}
                        aria-label={`Row ${rowNumber} type`}
                        className="min-h-11 md:min-h-11"
                        disabled={!editable}
                        id={draftFieldId("desktop", draft.id, "type")}
                        onChange={(event) => {
                          if (!event.target.value) return;
                          const patch = draftTypePatch(
                            draft,
                            event.target.value as TransactionType
                          );
                          onChange(draft.id, patch);
                          onPatch(draft.id, patch);
                        }}
                        ref={(node) => setControl(draft.id, "type", node)}
                        value={draft.type ?? ""}
                      >
                        {draft.type === null ? (
                          <option value="">Choose type</option>
                        ) : null}
                        {transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        aria-invalid={issueFor(draft, "title") ? true : undefined}
                        aria-label={`Row ${rowNumber} title`}
                        className="min-h-11 md:min-h-11"
                        disabled={!editable}
                        id={draftFieldId("desktop", draft.id, "title")}
                        onBlur={() => onPatch(draft.id, { title: draft.title })}
                        onChange={(event) => onChange(draft.id, { title: event.target.value || null })}
                        onKeyDown={(event) => navigateTextCell(event, draft.id, "title")}
                        onPaste={(event) => pasteCell(event, draft.id, "title")}
                        ref={(node) => setControl(draft.id, "title", node)}
                        value={draft.title ?? ""}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <Input
                          aria-invalid={issueFor(draft, "amountText") ? true : undefined}
                          aria-label={`Row ${rowNumber} amount`}
                          className="min-h-11 font-capture-data md:min-h-11"
                          disabled={!editable}
                          id={draftFieldId("desktop", draft.id, "amountText")}
                          inputMode="decimal"
                          onBlur={() => onPatch(draft.id, { amountText: draft.amountText })}
                          onChange={(event) => onChange(draft.id, { amountText: event.target.value || null })}
                          onKeyDown={(event) => navigateTextCell(event, draft.id, "amountText")}
                          onPaste={(event) => pasteCell(event, draft.id, "amountText")}
                          ref={(node) => setControl(draft.id, "amountText", node)}
                          value={draft.amountText ?? ""}
                        />
                        <span className="font-capture-data text-[0.6875rem] text-slate-500">{draft.currency}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        aria-invalid={sourceIssue ? true : undefined}
                        aria-label={`Row ${rowNumber} source`}
                        className="min-h-11 md:min-h-11"
                        disabled={!editable}
                        id={draftFieldId("desktop", draft.id, source)}
                        onChange={(event) => {
                          const patch = draftSourcePatch(
                            draft,
                            source,
                            event.target.value || null,
                            options.moneySources
                          );
                          onChange(draft.id, patch);
                          onPatch(draft.id, patch);
                        }}
                        ref={(node) => setControl(draft.id, "source", node)}
                        value={draft[source] ?? ""}
                      >
                        <option value="">Choose source</option>
                        {options.moneySources.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        aria-invalid={issueFor(draft, "categoryId") ? true : undefined}
                        aria-label={`Row ${rowNumber} category`}
                        className="min-h-11 md:min-h-11"
                        disabled={!editable}
                        id={draftFieldId("desktop", draft.id, "categoryId")}
                        onChange={(event) => {
                          const patch = { categoryId: event.target.value || null };
                          onChange(draft.id, patch);
                          onPatch(draft.id, patch);
                        }}
                        ref={(node) => setControl(draft.id, "categoryId", node)}
                        value={draft.categoryId ?? ""}
                      >
                        <option value="">No category</option>
                        {options.categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      {draft.type === TransactionType.EXPENSE ? (
                        <Select
                          aria-invalid={issueFor(draft, "qualityRating") ? true : undefined}
                          aria-label={`Row ${rowNumber} quality`}
                          className="min-h-11 md:min-h-11"
                          disabled={!editable}
                          id={draftFieldId("desktop", draft.id, "qualityRating")}
                          onChange={(event) => {
                            const patch = { qualityRating: (event.target.value || null) as QualityRating | null };
                            onChange(draft.id, patch);
                            onPatch(draft.id, patch);
                          }}
                          ref={(node) => setControl(draft.id, "qualityRating", node)}
                          value={draft.qualityRating ?? ""}
                        >
                          <option value="">—</option>
                          {qualityRatings.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                        </Select>
                      ) : <span className="block px-3 py-3 text-center text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        aria-controls={`desktop-inspector-${draft.id}`}
                        aria-expanded={expanded}
                        aria-label={`Edit details for row ${rowNumber}`}
                        className="min-h-11 rounded-md px-3 text-sm font-semibold text-capture-primary hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary"
                        onClick={() => setExpanded(draft.id)}
                        type="button"
                      >
                        {expanded ? "Close" : "Edit"}
                      </button>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr>
                      <td className="p-0" colSpan={11} id={`desktop-inspector-${draft.id}`}>
                        <DraftInspector
                          draft={draft}
                          onChange={onChange}
                          onFocusIssue={onFocusIssue}
                          onPatch={onPatch}
                          options={options}
                          rowNumber={rowNumber}
                          surface="desktop"
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
