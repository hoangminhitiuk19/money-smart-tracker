"use client";

import { TransactionType } from "@prisma/client";
import {
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { ColumnMapper } from "@/components/transaction-capture/ColumnMapper";
import { PasteInput } from "@/components/transaction-capture/PasteInput";
import { savePasteDrafts } from "@/lib/actions/transaction-drafts";
import {
  detectColumnMapping,
  mapParsedRows,
  parsePastedTable,
  type ColumnMapping,
  type DraftMappableField,
  type ParsedTable
} from "@/lib/transaction-drafts/paste";
import type { TransactionDraftView } from "@/lib/transaction-drafts/types";

type CaptureOption = {
  id: string;
  name: string;
};

type CaptureExpenseOption = CaptureOption & {
  amount: string;
  transactionDate: string;
};

export type CaptureWorkspaceProps = {
  initialCaptureKey: string | null;
  initialDrafts: readonly TransactionDraftView[];
  options: {
    categories: readonly CaptureOption[];
    moneySources: readonly CaptureOption[];
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
  const [drafts, setDrafts] =
    useState<readonly TransactionDraftView[]>(initialDrafts);
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
  const captureKeyRef = useRef<string | null>(initialCaptureKey);
  const tabId = captureWorkspaceId(initialCaptureKey);
  const tabRefs = useRef<Record<CaptureMode, HTMLButtonElement | null>>({
    quick: null,
    paste: null
  });
  const hasDrafts = drafts.length > 0;
  const persistedPasteCount = drafts.filter(
    ({ origin }) => origin === "PASTE"
  ).length;

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

    setSavingPaste(true);
    setPasteError(null);
    try {
      const result = await savePasteDrafts({ captureKey: nextCaptureKey, rows });
      if (!result.ok) {
        setPasteError(result.error);
        return;
      }
      setDrafts(result.drafts);
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
              <div
                className="mt-3 hidden min-w-0 rounded-xl border border-slate-200 bg-white p-6 lg:block"
                data-testid="capture-desktop-region"
              >
                <p className="text-sm text-slate-600 transition-[opacity,transform] duration-200 motion-reduce:transition-none">
                  Draft rows are ready for the desktop ledger.
                </p>
              </div>
              <div
                className="mt-3 min-w-0 rounded-xl border border-slate-200 bg-white p-5 lg:hidden"
                data-testid="capture-mobile-region"
              >
                <p className="text-sm text-slate-600 transition-[opacity,transform] duration-200 motion-reduce:transition-none">
                  Draft rows are ready for mobile review cards.
                </p>
              </div>
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
