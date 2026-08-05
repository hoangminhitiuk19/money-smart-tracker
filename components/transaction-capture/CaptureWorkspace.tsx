"use client";

import { MoneySourceType, TransactionType } from "@prisma/client";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { ColumnMapper } from "@/components/transaction-capture/ColumnMapper";
import { DraftCards } from "@/components/transaction-capture/DraftCards";
import {
  type DraftPatch,
  draftIsEditable,
  draftSourcePatch,
  draftTypePatch,
  draftFieldId,
  type DraftSurface
} from "@/components/transaction-capture/DraftInspector";
import {
  DraftFillToolbar,
  DraftLedger,
  type FillableDraftField
} from "@/components/transaction-capture/DraftLedger";
import { PasteInput } from "@/components/transaction-capture/PasteInput";
import {
  savePasteDrafts,
  updateTransactionDraft
} from "@/lib/actions/transaction-drafts";
import {
  detectColumnMapping,
  mapParsedRows,
  parsePastedTable,
  type ColumnMapping,
  type DraftMappableField,
  type ParsedTable
} from "@/lib/transaction-drafts/paste";
import {
  transactionDraftInputSchema,
  type DraftField,
  type TransactionDraftInput,
  type TransactionDraftView
} from "@/lib/transaction-drafts/types";

type CaptureOption = {
  id: string;
  name: string;
};

type CaptureExpenseOption = CaptureOption & {
  amount: string;
  transactionDate: string;
};

type CaptureMoneySourceOption = CaptureOption & {
  type: MoneySourceType;
};

export type CaptureWorkspaceProps = {
  initialCaptureKey: string | null;
  initialDrafts: readonly TransactionDraftView[];
  options: {
    categories: readonly CaptureOption[];
    moneySources: readonly CaptureMoneySourceOption[];
    projects: readonly CaptureOption[];
    expenses: readonly CaptureExpenseOption[];
  };
  settings: {
    defaultCurrency: string;
    dateFormat: string;
    numberFormat: string;
  };
};

type CaptureMode = "quick" | "paste";

const captureModes = ["quick", "paste"] as const satisfies readonly CaptureMode[];

const editableDraftFields = [
  "type",
  "amountText",
  "currency",
  "title",
  "description",
  "transactionDateText",
  "categoryId",
  "qualityRating",
  "fromMoneySourceId",
  "toMoneySourceId",
  "adjustedMoneySourceId",
  "adjustmentDirection",
  "adjustmentTarget",
  "projectId",
  "relatedTransactionId",
  "countTowardFeeWaiver",
  "recurringPaymentId",
  "isInstallmentRelated",
  "duplicateConfirmed"
] as const satisfies readonly (keyof DraftPatch)[];

type DraftVersionSnapshot = Map<keyof DraftPatch, number>;

type BulkPatchEntry = {
  id: string;
  patch: DraftPatch;
  versionsAtStart: DraftVersionSnapshot;
  collectionVersionAtStart: number;
};

const draftFieldLabels: Partial<
  Record<keyof TransactionDraftInput, string>
> = {
  type: "Type",
  amountText: "Amount",
  currency: "Currency",
  title: "Title",
  description: "Description",
  transactionDateText: "Date",
  categoryId: "Category",
  qualityRating: "Quality rating",
  fromMoneySourceId: "From account",
  toMoneySourceId: "To account",
  adjustmentDirection: "Adjustment direction",
  adjustmentTarget: "Adjustment target",
  projectId: "Project",
  relatedTransactionId: "Related transaction"
};

function localDateText(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function captureWorkspaceId(captureKey: string | null) {
  const safeCaptureKey = captureKey
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `capture-workspace-${safeCaptureKey || "new"}`;
}

function readableRawColumnLabel(value: string) {
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    const hiddenFormat =
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff;
    return code < 32 || (code >= 127 && code <= 159) || hiddenFormat
      ? " "
      : character;
  }).join("");
  const collapsed = withoutControls.replace(/\s+/g, " ").trim() || "Unnamed";
  return collapsed.length > 80 ? `${collapsed.slice(0, 79)}…` : collapsed;
}

function mappedDraftPreflightError(
  rows: readonly TransactionDraftInput[]
): string | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const result = transactionDraftInputSchema.safeParse(row);
    if (result.success) continue;

    const issue = result.error.issues[0];
    const field = issue.path[0];
    const rawColumn =
      field === "rawRow" && typeof issue.path[1] === "string"
        ? issue.path[1]
        : null;
    const label = rawColumn
      ? `“${readableRawColumnLabel(rawColumn)}” source column`
      : typeof field === "string"
        ? (draftFieldLabels[field as keyof TransactionDraftInput] ?? "Mapped value")
        : "Mapped value";

    if (issue.code === "too_big" && typeof issue.maximum === "number") {
      return `Row ${rowIndex + 1}: ${label} cannot exceed ${issue.maximum.toLocaleString("en-US")} characters. Shorten this value and try again.`;
    }

    return `Row ${rowIndex + 1}: ${label} is not valid. Correct this value and try again.`;
  }

  return null;
}

const modeDetails: Record<
  CaptureMode,
  { label: string; title: string; description: string }
> = {
  quick: {
    label: "Quick add",
    title: "Add one transaction",
    description:
      "Use a compact entry for a purchase, transfer, income, refund, or adjustment."
  },
  paste: {
    label: "Paste rows",
    title: "Bring in spreadsheet rows",
    description:
      "Paste copied rows here, then review every field before anything is saved."
  }
};

function applyInitialDraftDefaults(
  initialDrafts: readonly TransactionDraftView[],
  defaultCurrency: string
) {
  const patches: { id: string; patch: DraftPatch }[] = [];
  let previousType: TransactionDraftView["type"] = null;

  for (const draft of initialDrafts) {
    const patch: DraftPatch = {};
    if (draftIsEditable(draft) && !draft.currency?.trim()) {
      patch.currency = defaultCurrency;
    }
    if (draftIsEditable(draft) && !draft.type && previousType) {
      patch.type = previousType;
    }

    if (Object.keys(patch).length > 0) {
      patches.push({ id: draft.id, patch });
    }
    if (draftIsEditable(draft)) {
      previousType = draft.type ?? previousType;
    }
  }

  return { drafts: initialDrafts, patches };
}

export function CaptureWorkspace({
  initialCaptureKey,
  initialDrafts,
  options,
  settings
}: CaptureWorkspaceProps) {
  const hasInitialPasteDrafts = initialDrafts.some(
    ({ origin }) => origin === "PASTE"
  );
  const [mode, setMode] = useState<CaptureMode>(
    hasInitialPasteDrafts ? "paste" : "quick"
  );
  const initialDefaultsRef = useRef<ReturnType<
    typeof applyInitialDraftDefaults
  > | null>(null);
  initialDefaultsRef.current ??= applyInitialDraftDefaults(
    initialDrafts,
    settings.defaultCurrency
  );
  const [drafts, setDrafts] = useState<readonly TransactionDraftView[]>(
    initialDefaultsRef.current.drafts
  );
  const [pasteText, setPasteText] = useState("");
  const [pasteTable, setPasteTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [ambiguousFields, setAmbiguousFields] =
    useState<readonly DraftMappableField[]>([]);
  const [defaultType, setDefaultType] = useState<TransactionType>(
    TransactionType.EXPENSE
  );
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [savingPaste, setSavingPaste] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [fillField, setFillField] =
    useState<FillableDraftField>("categoryId");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [ledgerAnnouncement, setLedgerAnnouncement] = useState("");
  const captureKeyRef = useRef<string | null>(initialCaptureKey);
  const draftsRef = useRef<readonly TransactionDraftView[]>(
    initialDefaultsRef.current.drafts
  );
  const fieldVersionsRef = useRef(new Map<string, number>());
  const draftCollectionVersionRef = useRef(0);
  const bulkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const bulkOperationCountRef = useRef(0);
  const attemptedInitialDefaultsRef = useRef(false);
  const tabId = captureWorkspaceId(initialCaptureKey);
  const tabRefs = useRef<Record<CaptureMode, HTMLButtonElement | null>>({
    quick: null,
    paste: null
  });
  const hasDrafts = drafts.length > 0;
  const persistedPasteCount = drafts.filter(
    ({ origin }) => origin === "PASTE"
  ).length;

  function fieldVersionKey(id: string, field: keyof DraftPatch) {
    return `${id}:${field}`;
  }

  function fieldVersion(id: string, field: keyof DraftPatch) {
    return fieldVersionsRef.current.get(fieldVersionKey(id, field)) ?? 0;
  }

  function snapshotVersions(id: string): DraftVersionSnapshot {
    return new Map(
      editableDraftFields.map((field) => [field, fieldVersion(id, field)])
    );
  }

  function updateDraftState(
    updater: (
      current: readonly TransactionDraftView[]
    ) => readonly TransactionDraftView[]
  ) {
    setDrafts((current) => {
      const next = updater(current);
      draftsRef.current = next;
      return next;
    });
  }

  function applyLocalPatch(id: string, patch: DraftPatch, touched = true) {
    if (touched) {
      for (const field of Object.keys(patch) as (keyof DraftPatch)[]) {
        const key = fieldVersionKey(id, field);
        fieldVersionsRef.current.set(key, (fieldVersionsRef.current.get(key) ?? 0) + 1);
      }
    }
    updateDraftState((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
    );
  }

  function mergeAuthoritativeDraft(
    serverDraft: TransactionDraftView,
    versionsAtRequest: DraftVersionSnapshot
  ) {
    updateDraftState((current) =>
      current.map((draft) => {
        if (draft.id !== serverDraft.id) return draft;

        const merged: TransactionDraftView = {
          ...serverDraft,
          possibleDuplicate:
            serverDraft.possibleDuplicate ||
            serverDraft.duplicateConfirmed
        };
        for (const field of editableDraftFields) {
          if (fieldVersion(serverDraft.id, field) > (versionsAtRequest.get(field) ?? 0)) {
            Object.assign(merged, { [field]: draft[field] });
          }
        }
        return merged;
      })
    );
  }

  function rowNumberFor(id: string) {
    const index = draftsRef.current.findIndex((draft) => draft.id === id);
    return index >= 0 ? index + 1 : null;
  }

  async function requestDraftPatch(
    id: string,
    patch: DraftPatch,
    versionsAtRequest: DraftVersionSnapshot
  ) {
    const collectionVersionAtRequest = draftCollectionVersionRef.current;
    try {
      const result = await updateTransactionDraft(id, patch);
      if (collectionVersionAtRequest !== draftCollectionVersionRef.current) {
        return {
          ok: false as const,
          stale: true as const,
          error: "Draft list changed."
        };
      }
      if (!result.ok) return { ok: false as const, error: result.error };
      mergeAuthoritativeDraft(result.draft, versionsAtRequest);
      return { ok: true as const, draft: result.draft };
    } catch {
      return {
        ok: false as const,
        error: "Check your connection and try again."
      };
    }
  }

  async function patchDraft(id: string, patch: DraftPatch) {
    const current = draftsRef.current.find((draft) => draft.id === id);
    if (!current || !draftIsEditable(current)) return;
    const versionsAtRequest = snapshotVersions(id);
    const result = await requestDraftPatch(id, patch, versionsAtRequest);
    const rowNumber = rowNumberFor(id);
    if (!rowNumber) return;

    if (!result.ok) {
      if ("stale" in result && result.stale) return;
      setLedgerAnnouncement(`Row ${rowNumber} was not saved: ${result.error}`);
      return;
    }
    setLedgerAnnouncement(
      result.draft.status === "READY"
        ? `Row ${rowNumber} is ready.`
        : `Row ${rowNumber} saved with ${result.draft.issues.length} ${result.draft.issues.length === 1 ? "finding" : "findings"}.`
    );
  }

  function patchFieldsAreUntouched(entry: BulkPatchEntry) {
    return entry.collectionVersionAtStart === draftCollectionVersionRef.current &&
      (Object.keys(entry.patch) as (keyof DraftPatch)[]).every(
      (field) =>
        fieldVersion(entry.id, field) ===
        (entry.versionsAtStart.get(field) ?? 0)
    );
  }

  function queueBulkOperation(operation: () => Promise<void>) {
    bulkOperationCountRef.current += 1;
    setBulkBusy(true);
    const scheduled = bulkQueueRef.current.then(operation, operation);
    bulkQueueRef.current = scheduled.catch(() => undefined);
    void scheduled
      .finally(() => {
        bulkOperationCountRef.current -= 1;
        if (bulkOperationCountRef.current === 0) setBulkBusy(false);
      })
      .catch(() => undefined);
  }

  async function runBulkPatches(
    entries: readonly BulkPatchEntry[],
    messages: {
      complete: (saved: number) => string;
      partial: (saved: number, attempted: number, failed: number) => string;
      skipped: (saved: number, skipped: number) => string;
    }
  ) {
    let attempted = 0;
    let saved = 0;
    let failed = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (!patchFieldsAreUntouched(entry)) {
        skipped += 1;
        continue;
      }

      const current = draftsRef.current.find((draft) => draft.id === entry.id);
      if (!current) {
        skipped += 1;
        continue;
      }
      const previous = Object.fromEntries(
        (Object.keys(entry.patch) as (keyof DraftPatch)[]).map((field) => [
          field,
          current[field]
        ])
      ) as DraftPatch;
      applyLocalPatch(entry.id, entry.patch);
      attempted += 1;
      const versionsAtRequest = snapshotVersions(entry.id);
      const result = await requestDraftPatch(
        entry.id,
        entry.patch,
        versionsAtRequest
      );
      if (result.ok) {
        saved += 1;
      } else if ("stale" in result && result.stale) {
        skipped += 1;
      } else {
        failed += 1;
        const rollback = Object.fromEntries(
          (Object.keys(entry.patch) as (keyof DraftPatch)[]).flatMap(
            (field) =>
              fieldVersion(entry.id, field) ===
              (versionsAtRequest.get(field) ?? 0)
                ? [[field, previous[field]]]
                : []
          )
        ) as DraftPatch;
        if (Object.keys(rollback).length > 0) {
          applyLocalPatch(entry.id, rollback);
        }
      }
    }

    if (failed > 0) {
      setLedgerAnnouncement(messages.partial(saved, attempted, failed));
    } else if (skipped > 0) {
      setLedgerAnnouncement(messages.skipped(saved, skipped));
    } else {
      setLedgerAnnouncement(messages.complete(saved));
    }
  }

  function semanticSourceField(draft: TransactionDraftView) {
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

  function fillDown(field: FillableDraftField) {
    const selected = draftsRef.current.filter(
      (draft) => selectedIds.has(draft.id) && draftIsEditable(draft)
    );
    if (selected.length < 2) return;
    const sourceDraft = selected[0];

    let sourceField: keyof DraftPatch = field as keyof DraftPatch;
    if (field === "source") {
      sourceField = semanticSourceField(sourceDraft);
      if (
        selected.some(
          (draft) => semanticSourceField(draft) !== sourceField
        )
      ) {
        setLedgerAnnouncement(
          "Source fill needs selected rows with the same transaction flow."
        );
        return;
      }
    }

    const entries = selected.slice(1).map((draft): BulkPatchEntry => {
      const patch =
        field === "type" && sourceDraft.type
          ? draftTypePatch(draft, sourceDraft.type)
          : field === "source"
            ? draftSourcePatch(
                draft,
                semanticSourceField(draft),
                sourceDraft[semanticSourceField(sourceDraft)],
                options.moneySources
              )
          : ({ [sourceField]: sourceDraft[sourceField] } as DraftPatch);
      return {
        id: draft.id,
        patch,
        versionsAtStart: snapshotVersions(draft.id),
        collectionVersionAtStart: draftCollectionVersionRef.current
      };
    });

    queueBulkOperation(() =>
      runBulkPatches(entries, {
        complete: (saved) =>
          saved === 1 ? "Updated 1 row." : `Updated ${saved} rows.`,
        partial: (saved, attempted, failed) =>
          `Updated ${saved} of ${attempted} rows. ${failed} ${failed === 1 ? "row was" : "rows were"} not saved.`,
        skipped: (saved, skipped) =>
          `${saved === 1 ? "Updated 1 row" : `Updated ${saved} rows`}. Skipped ${skipped} ${skipped === 1 ? "row" : "rows"} changed during fill.`
      })
    );
  }

  function pasteCells(
    draftId: string,
    field: FillableDraftField,
    clipboardText: string
  ) {
    if (field === "source" || clipboardText.includes("\t")) {
      setLedgerAnnouncement("Paste one editable column at a time.");
      return;
    }
    const values = clipboardText.replace(/\r\n?/g, "\n").split("\n");
    if (values.at(-1) === "") values.pop();
    const selected = draftsRef.current.filter(
      (draft) => selectedIds.has(draft.id) && draftIsEditable(draft)
    );
    const targets = selected.length > 0
      ? selected
      : draftsRef.current.filter(
          (draft) => draft.id === draftId && draftIsEditable(draft)
        );
    const entries = targets.slice(0, values.length).map((draft, index) => ({
      id: draft.id,
      patch: { [field]: values[index] || null } as DraftPatch,
      versionsAtStart: snapshotVersions(draft.id),
      collectionVersionAtStart: draftCollectionVersionRef.current
    }));

    queueBulkOperation(() =>
      runBulkPatches(entries, {
        complete: (saved) => `Updated ${saved} ${saved === 1 ? "row" : "rows"} from pasted cells.`,
        partial: (saved, attempted, failed) =>
          `Updated ${saved} of ${attempted} pasted rows. ${failed} ${failed === 1 ? "row was" : "rows were"} not saved.`,
        skipped: (saved, skipped) =>
          `Updated ${saved} pasted ${saved === 1 ? "row" : "rows"}. Skipped ${skipped} changed ${skipped === 1 ? "row" : "rows"}.`
      })
    );
  }

  function focusIssue(id: string, field: DraftField, surface: DraftSurface) {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
    const target =
      document.getElementById(draftFieldId(surface, id, field)) ??
      document.getElementById(`${surface}-draft-${safeId}-inspector`);
    target?.focus();
  }

  useEffect(() => {
    if (attemptedInitialDefaultsRef.current) return;
    attemptedInitialDefaultsRef.current = true;
    const defaults = initialDefaultsRef.current?.patches ?? [];
    if (defaults.length === 0) return;

    const entries = defaults.map(({ id, patch }) => ({
      id,
      patch,
      versionsAtStart: snapshotVersions(id),
      collectionVersionAtStart: draftCollectionVersionRef.current
    }));
    queueBulkOperation(() =>
      runBulkPatches(entries, {
        complete: (saved) =>
          `Applied ${saved} ${saved === 1 ? "row default" : "row defaults"}.`,
        partial: (saved, attempted, failed) =>
          `Applied ${saved} of ${attempted} row defaults. ${failed} ${failed === 1 ? "default was" : "defaults were"} not saved.`,
        skipped: (saved, skipped) =>
          `Applied ${saved} ${saved === 1 ? "row default" : "row defaults"}. Skipped ${skipped} changed ${skipped === 1 ? "row" : "rows"}.`
      })
    );
    // The immutable initial default list is intentionally attempted once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function friendlyPasteError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("cannot exceed 1000000 UTF-8 bytes")) {
      return "Paste input cannot exceed 1,000,000 UTF-8 bytes. Remove some rows or split the batch.";
    }
    if (message.includes("cannot contain more than 200 rows")) {
      return "Paste input cannot contain more than 200 rows. Remove a row or split the batch.";
    }
    if (message.includes("must be CSV or TSV")) {
      return "Use comma-separated (CSV) or tab-separated (TSV) rows.";
    }
    if (message.includes("inconsistent rows")) {
      return "Make every row use the same number of columns, then try again.";
    }
    if (message.includes("at least one column")) {
      return "Paste at least one spreadsheet row.";
    }
    return "The rows could not be read. Check separators and unmatched quotes, then try again.";
  }

  function updatePasteText(value: string) {
    setPasteText(value);
    setPasteError(null);
    if (value.trim() === "") {
      setPasteTable(null);
      setMapping({});
      setAmbiguousFields([]);
      return;
    }

    try {
      const table = parsePastedTable(value);
      if (table.rows.length === 0) {
        setPasteTable(null);
        setMapping({});
        setAmbiguousFields([]);
        setPasteError("Add at least one data row below the headings.");
        return;
      }
      const detected = detectColumnMapping(table.columns);
      setPasteTable(table);
      setMapping(detected.mapping);
      setAmbiguousFields(detected.ambiguousFields);
    } catch (error) {
      setPasteTable(null);
      setMapping({});
      setAmbiguousFields([]);
      setPasteError(friendlyPasteError(error));
    }
  }

  function changeMapping(
    field: DraftMappableField,
    columnIndex: number | undefined
  ) {
    setMapping((current) => {
      const next = { ...current };
      if (columnIndex !== undefined) {
        for (const [mappedField, mappedIndex] of Object.entries(next)) {
          if (mappedField !== field && mappedIndex === columnIndex) {
            delete next[mappedField as DraftMappableField];
          }
        }
        next[field] = columnIndex;
      } else {
        delete next[field];
      }
      return next;
    });
  }

  function captureKey() {
    captureKeyRef.current ??= crypto.randomUUID();
    return captureKeyRef.current;
  }

  async function reviewPasteRows() {
    if (
      !pasteTable ||
      ambiguousFields.some((field) => mapping[field] === undefined)
    ) {
      return;
    }

    const nextCaptureKey = captureKey();
    const rows = mapParsedRows(pasteTable, mapping, {
      captureKey: nextCaptureKey,
      defaults: {
        currency: settings.defaultCurrency,
        transactionDateText: localDateText(new Date()),
        type: defaultType
      },
      categories: options.categories,
      moneySources: options.moneySources,
      projects: options.projects
    });
    const preflightError = mappedDraftPreflightError(rows);
    if (preflightError) {
      setPasteError(preflightError);
      return;
    }

    setSavingPaste(true);
    setPasteError(null);
    try {
      const result = await savePasteDrafts({ captureKey: nextCaptureKey, rows });
      if (!result.ok) {
        setPasteError(result.error);
        return;
      }
      draftCollectionVersionRef.current += 1;
      fieldVersionsRef.current.clear();
      setSelectedIds(new Set());
      updateDraftState(() => result.drafts);
      window.history.replaceState(
        window.history.state,
        "",
        `/transactions/capture?capture=${nextCaptureKey}`
      );
    } catch {
      setPasteError(
        "Drafts could not be saved. Check your connection and try again."
      );
    } finally {
      setSavingPaste(false);
    }
  }

  function activateTab(nextMode: CaptureMode, moveFocus = false) {
    setMode(nextMode);
    if (moveFocus) {
      tabRefs.current[nextMode]?.focus();
    }
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: CaptureMode
  ) {
    const currentIndex = captureModes.indexOf(currentMode);
    let nextMode: CaptureMode | null = null;

    switch (event.key) {
      case "ArrowRight":
        nextMode = captureModes[(currentIndex + 1) % captureModes.length];
        break;
      case "ArrowLeft":
        nextMode =
          captureModes[
            (currentIndex - 1 + captureModes.length) % captureModes.length
          ];
        break;
      case "Home":
        nextMode = captureModes[0];
        break;
      case "End":
        nextMode = captureModes[captureModes.length - 1];
        break;
      default:
        return;
    }

    event.preventDefault();
    activateTab(nextMode, true);
  }

  return (
    <section className="min-w-0 overflow-x-clip bg-capture-canvas font-capture-ui text-capture-ink">
      <header className="border-b border-slate-200 bg-white px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[90rem] flex-col gap-2">
          <p className="font-capture-data text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-capture-primary">
            Living ledger
          </p>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h1 className="font-capture-display text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
                Capture transactions
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                Turn rough entries into transactions you have checked and trust.
              </p>
            </div>
            <p className="font-capture-data text-xs text-slate-500">
              Draft currency · {settings.defaultCurrency}
            </p>
          </div>
        </div>
      </header>

      <div className="sticky top-0 z-10 border-b border-slate-200 bg-capture-canvas px-4 py-3 sm:px-6 lg:px-8">
        <div
          aria-label="Capture method"
          className="mx-auto flex max-w-[90rem] gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1"
          role="tablist"
        >
          {captureModes.map((modeName) => {
            const selected = modeName === mode;
            const details = modeDetails[modeName];

            return (
              <button
                aria-controls={`${tabId}-${modeName}-panel`}
                aria-selected={selected}
                className={`min-h-11 shrink-0 rounded-md px-4 text-sm font-semibold ${
                  selected
                    ? "bg-capture-primary text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-capture-ink"
                }`}
                id={`${tabId}-${modeName}-tab`}
                key={modeName}
                onClick={() => activateTab(modeName)}
                onKeyDown={(event) => handleTabKeyDown(event, modeName)}
                ref={(element) => {
                  tabRefs.current[modeName] = element;
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {details.label}
              </button>
            );
          })}

          <button
            aria-label="Email (planned)"
            aria-controls={`${tabId}-email-panel`}
            aria-disabled="true"
            aria-selected="false"
            className="flex min-h-11 shrink-0 cursor-not-allowed items-center gap-2 rounded-md px-4 text-sm font-medium text-slate-400"
            disabled
            id={`${tabId}-email-tab`}
            role="tab"
            tabIndex={-1}
            type="button"
          >
            Email
            <span className="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-capture-data text-[0.625rem] font-semibold uppercase tracking-wide text-slate-500">
              Planned
            </span>
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[90rem] px-4 py-5 sm:px-6 lg:px-8">
        {captureModes.map((modeName) => {
          const details = modeDetails[modeName];

          return (
            <div
              aria-labelledby={`${tabId}-${modeName}-tab`}
              className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
              hidden={mode !== modeName}
              id={`${tabId}-${modeName}-panel`}
              key={modeName}
              role="tabpanel"
              tabIndex={0}
            >
              <h2 className="font-capture-display text-lg font-semibold">
                {details.title}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                {details.description}
              </p>
              {modeName === "paste" ? (
                <>
                  {persistedPasteCount > 0 ? (
                    <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-capture-confirmed" role="status">
                      {persistedPasteCount} persisted {persistedPasteCount === 1 ? "row" : "rows"} ready for review
                    </p>
                  ) : null}
                  <PasteInput
                    byteCount={new TextEncoder().encode(pasteText).byteLength}
                    error={pasteError}
                    onInputError={setPasteError}
                    onTextChange={updatePasteText}
                    rowCount={pasteTable?.rows.length ?? null}
                    value={pasteText}
                  />
                  {pasteTable ? (
                    <>
                      <p className="mt-4 font-capture-data text-xs font-semibold text-capture-confirmed" role="status">
                        {pasteTable.rows.length} {pasteTable.rows.length === 1 ? "row" : "rows"} detected
                      </p>
                      <ColumnMapper
                        ambiguousFields={ambiguousFields}
                        defaultType={defaultType}
                        mapping={mapping}
                        onDefaultTypeChange={setDefaultType}
                        onMappingChange={changeMapping}
                        onReview={reviewPasteRows}
                        saving={savingPaste}
                        table={pasteTable}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
        <div
          aria-labelledby={`${tabId}-email-tab`}
          hidden
          id={`${tabId}-email-panel`}
          role="tabpanel"
          tabIndex={0}
        >
          Email capture is planned.
        </div>

        <section aria-labelledby={`${tabId}-review-heading`} className="mt-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2
              className="font-capture-display text-lg font-semibold"
              id={`${tabId}-review-heading`}
            >
              Review ledger
            </h2>
            {hasDrafts ? (
              <p className="font-capture-data text-xs text-slate-500">
                {drafts.length} {drafts.length === 1 ? "row" : "rows"}
              </p>
            ) : null}
          </div>

          {hasDrafts ? (
            <>
              <DraftFillToolbar
                busy={bulkBusy}
                field={fillField}
                onFieldChange={setFillField}
                onFillDown={fillDown}
                selectedCount={selectedIds.size}
              />
              {ledgerAnnouncement ? (
                <p
                  aria-live="polite"
                  className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-capture-ink"
                  role="status"
                >
                  {ledgerAnnouncement}
                </p>
              ) : null}
              <DraftLedger
                drafts={drafts}
                onCellPaste={pasteCells}
                onChange={applyLocalPatch}
                onFocusIssue={focusIssue}
                onPatch={patchDraft}
                onSelectionChange={setSelectedIds}
                options={options}
                selectedIds={selectedIds}
              />
              <DraftCards
                drafts={drafts}
                onCellPaste={pasteCells}
                onChange={applyLocalPatch}
                onFocusIssue={focusIssue}
                onPatch={patchDraft}
                onSelectionChange={setSelectedIds}
                options={options}
                selectedIds={selectedIds}
              />
            </>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center sm:py-14">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-capture-primary">
                <svg
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <path d="M6 4h9l3 3v13H6z" />
                  <path d="M15 4v4h4" />
                  <path d="M9 12h6M9 16h4" />
                </svg>
              </div>
              <h3 className="mt-4 font-capture-display text-base font-semibold">
                Start with one transaction or paste a spreadsheet
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                Your drafts will appear here with a visible origin and review
                status before you save them.
              </p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
