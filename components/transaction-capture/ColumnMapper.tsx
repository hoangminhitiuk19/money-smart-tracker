"use client";

import type { TransactionType } from "@prisma/client";
import type {
  ColumnMapping,
  DraftMappableField,
  ParsedTable
} from "@/lib/transaction-drafts/paste";

const fieldDetails: readonly {
  field: DraftMappableField;
  label: string;
}[] = [
  { field: "transactionDateText", label: "Date" },
  { field: "type", label: "Type" },
  { field: "title", label: "Title" },
  { field: "amountText", label: "Amount" },
  { field: "currency", label: "Currency" },
  { field: "categoryId", label: "Category" },
  { field: "qualityRating", label: "Quality rating" },
  { field: "fromMoneySourceId", label: "From account" },
  { field: "toMoneySourceId", label: "To account" },
  { field: "projectId", label: "Project" },
  { field: "description", label: "Description" },
  { field: "adjustmentDirection", label: "Adjustment direction" },
  { field: "adjustmentTarget", label: "Adjustment target" },
  { field: "relatedTransactionId", label: "Related transaction" }
];

const transactionTypes = [
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "REFUND",
  "ADJUSTMENT"
] as const satisfies readonly TransactionType[];

const readableType: Record<TransactionType, string> = {
  INCOME: "Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment"
};

const universalRequired = new Set<DraftMappableField>([
  "transactionDateText",
  "title",
  "amountText"
]);

function requiredFields(type: TransactionType) {
  const fields = new Set(universalRequired);
  if (type === "INCOME" || type === "REFUND" || type === "TRANSFER") {
    fields.add("toMoneySourceId");
  }
  if (type === "EXPENSE" || type === "TRANSFER") {
    fields.add("fromMoneySourceId");
  }
  if (type === "ADJUSTMENT") {
    fields.add("adjustmentDirection");
  }
  return fields;
}

function columnOptionLabel(table: ParsedTable, index: number) {
  const column = table.columns[index];
  const sample = column.samples.find((value) => value.length > 0);
  const source = `Column ${index + 1}: ${column.label}`;
  return sample ? `${source} · ${sample}` : source;
}

function cell(
  table: ParsedTable,
  rowIndex: number,
  mapping: ColumnMapping,
  field: DraftMappableField
) {
  const columnIndex = mapping[field];
  return columnIndex === undefined ? "—" : (table.rows[rowIndex]?.[columnIndex] || "—");
}

type ColumnMapperProps = {
  table: ParsedTable;
  mapping: ColumnMapping;
  ambiguousFields: readonly DraftMappableField[];
  defaultType: TransactionType;
  saving: boolean;
  onMappingChange: (
    field: DraftMappableField,
    columnIndex: number | undefined
  ) => void;
  onDefaultTypeChange: (type: TransactionType) => void;
  onReview: () => void;
};

export function ColumnMapper({
  table,
  mapping,
  ambiguousFields,
  defaultType,
  saving,
  onMappingChange,
  onDefaultTypeChange,
  onReview
}: ColumnMapperProps) {
  const required = requiredFields(defaultType);
  const unresolvedAmbiguities = ambiguousFields.filter(
    (field) => mapping[field] === undefined
  );
  const selectedColumns = new Set(
    Object.values(mapping).filter((value): value is number => value !== undefined)
  );

  return (
    <section
      aria-labelledby="column-mapping-heading"
      className="mt-6 border-t border-slate-200 pt-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-capture-data text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-capture-primary">
            Raw → ledger
          </p>
          <h3
            className="mt-1 font-capture-display text-base font-semibold"
            id="column-mapping-heading"
          >
            Match columns
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Each source column can fill one ledger field. Required markers show
            what {readableType[defaultType].toLowerCase()} rows need to become
            ready.
          </p>
        </div>
        <label className="text-sm font-semibold text-capture-ink">
          Default transaction type
          <select
            className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal focus:border-capture-primary focus:outline-none focus:ring-2 focus:ring-indigo-100"
            onChange={(event) =>
              onDefaultTypeChange(event.target.value as TransactionType)
            }
            value={defaultType}
          >
            {transactionTypes.map((type) => (
              <option key={type} value={type}>
                {readableType[type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {unresolvedAmbiguities.length > 0 ? (
        <div
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {unresolvedAmbiguities.map((field) => {
            const label =
              fieldDetails.find((detail) => detail.field === field)?.label ??
              field;
            return <p key={field}>Choose which {label} column to use.</p>;
          })}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fieldDetails.map(({ field, label }) => {
          const selected = mapping[field];
          return (
            <label
              className="min-w-0 text-xs font-semibold text-slate-700"
              key={field}
            >
              <span>{label} column</span>
              {required.has(field) ? (
                <span className="ml-1 font-capture-data text-[0.625rem] uppercase tracking-wide text-capture-review">
                  Required
                </span>
              ) : null}
              <select
                aria-label={`${label} column`}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-capture-ink focus:border-capture-primary focus:outline-none focus:ring-2 focus:ring-indigo-100"
                onChange={(event) =>
                  onMappingChange(
                    field,
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value)
                  )
                }
                value={selected ?? ""}
              >
                <option value="">Not mapped</option>
                {table.columns.map((column) => (
                  <option
                    disabled={
                      selectedColumns.has(column.index) &&
                      selected !== column.index
                    }
                    key={column.index}
                    value={column.index}
                  >
                    {columnOptionLabel(table, column.index)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
        <table
          aria-label="Mapped row preview"
          className="w-full min-w-[36rem] border-collapse text-left text-sm"
        >
          <thead className="bg-slate-50 font-capture-data text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold" scope="col">Row</th>
              <th className="px-3 py-2 font-semibold" scope="col">Date</th>
              <th className="px-3 py-2 font-semibold" scope="col">Type</th>
              <th className="px-3 py-2 font-semibold" scope="col">Title</th>
              <th className="px-3 py-2 font-semibold" scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 3).map((_, rowIndex) => (
              <tr className="border-t border-slate-200" key={rowIndex}>
                <th
                  className="px-3 py-2 font-capture-data text-xs text-slate-500"
                  scope="row"
                >
                  {rowIndex + 1}
                </th>
                <td className="px-3 py-2">
                  {cell(table, rowIndex, mapping, "transactionDateText")}
                </td>
                <td className="px-3 py-2">
                  {cell(table, rowIndex, mapping, "type") === "—"
                    ? readableType[defaultType]
                    : cell(table, rowIndex, mapping, "type")}
                </td>
                <td className="px-3 py-2">{cell(table, rowIndex, mapping, "title")}</td>
                <td className="px-3 py-2 font-capture-data tabular-nums">{cell(table, rowIndex, mapping, "amountText")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          Missing required fields stay editable as drafts; ambiguous headings
          must be resolved before review.
          {defaultType === "ADJUSTMENT"
            ? " Choose the adjusted account during row review."
            : ""}
        </p>
        <button
          className="min-h-11 rounded-md bg-capture-primary px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={saving || unresolvedAmbiguities.length > 0}
          onClick={onReview}
          type="button"
        >
          {saving ? "Saving drafts…" : "Review rows"}
        </button>
      </div>
    </section>
  );
}
