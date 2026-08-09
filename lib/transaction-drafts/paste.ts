import * as Papa from "papaparse";
import type { QualityRating, TransactionType } from "@prisma/client";
import type {
  InvalidMappedDraftField,
  TransactionDraftInput
} from "@/lib/transaction-drafts/types";

export const MAX_PASTE_BYTES = 1_000_000;
export const MAX_DRAFT_ROWS = 200;

export type PasteColumn = {
  index: number;
  label: string;
  samples: string[];
};

export type ParsedTable = {
  columns: PasteColumn[];
  rows: string[][];
  delimiter: "," | "\t";
  hasHeader: boolean;
};

export type DraftMappableField =
  | "transactionDateText"
  | "type"
  | "title"
  | "amountText"
  | "currency"
  | "categoryId"
  | "qualityRating"
  | "fromMoneySourceId"
  | "toMoneySourceId"
  | "projectId"
  | "description"
  | "adjustmentDirection"
  | "adjustmentTarget"
  | "relatedTransactionId";

export type ColumnMapping = Partial<Record<DraftMappableField, number>>;

export type DetectedColumnMapping = {
  mapping: ColumnMapping;
  ambiguousFields: DraftMappableField[];
};

export type PasteMappingContext = {
  captureKey: string;
  defaults: {
    currency: string;
    transactionDateText: string;
    type: TransactionType;
  };
  categories: readonly {
    id: string;
    name: string;
    defaultQualityRating?: QualityRating | null;
  }[];
  moneySources: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string }[];
};

const mappableFields: readonly DraftMappableField[] = [
  "transactionDateText",
  "type",
  "title",
  "amountText",
  "currency",
  "categoryId",
  "qualityRating",
  "fromMoneySourceId",
  "toMoneySourceId",
  "projectId",
  "description",
  "adjustmentDirection",
  "adjustmentTarget",
  "relatedTransactionId"
];

const fieldAliases: Record<DraftMappableField, readonly string[]> = {
  transactionDateText: ["date", "transaction date", "ngay", "ngay giao dich"],
  type: ["type", "transaction type", "loai", "loai giao dich"],
  title: ["title", "merchant", "payee", "noi dung", "content", "name"],
  amountText: ["amount", "so tien", "value", "gia tri"],
  currency: ["currency", "currency code", "tien te"],
  categoryId: ["category", "danh muc"],
  qualityRating: ["quality", "quality rating", "rating", "xep hang"],
  fromMoneySourceId: [
    "from",
    "source",
    "account",
    "from source",
    "from account",
    "nguon",
    "tai khoan"
  ],
  toMoneySourceId: [
    "to",
    "destination",
    "dest",
    "to source",
    "to account",
    "den"
  ],
  projectId: ["project", "du an"],
  description: ["description", "note", "memo", "ghi chu", "dien giai"],
  adjustmentDirection: ["adjustment direction", "direction", "huong dieu chinh"],
  adjustmentTarget: ["adjustment target", "target", "muc dieu chinh"],
  relatedTransactionId: [
    "related transaction",
    "related transaction id",
    "related id",
    "refund transaction"
  ]
};

function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function headerFields(label: string): DraftMappableField[] {
  const normalized = normalizeLabel(label);

  return mappableFields.filter((field) =>
    fieldAliases[field].some((alias) => normalizeLabel(alias) === normalized)
  );
}

function uniqueColumnLabels(labels: readonly string[]) {
  const counts = new Map<string, number>();

  return labels.map((label, index) => {
    const baseLabel = label || `Column ${index + 1}`;
    const count = (counts.get(baseLabel) ?? 0) + 1;
    counts.set(baseLabel, count);
    return count === 1 ? baseLabel : `${baseLabel} (${count})`;
  });
}

function tableColumns(labels: readonly string[], rows: readonly string[][]) {
  return labels.map((label, index) => ({
    index,
    label,
    samples: rows.slice(0, 3).map((row) => row[index] ?? "")
  }));
}

function paddedRows(rows: readonly string[][], columnCount: number) {
  if (!Number.isFinite(columnCount) || columnCount === 0) {
    throw new Error("Paste input must contain at least one column.");
  }

  return rows.map((row) => {
    if (row.length > columnCount) {
      throw new Error("Paste input has inconsistent rows.");
    }

    return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
  });
}

export function parsePastedTable(text: string): ParsedTable {
  if (new TextEncoder().encode(text).byteLength > MAX_PASTE_BYTES) {
    throw new Error(`Paste input cannot exceed ${MAX_PASTE_BYTES} UTF-8 bytes.`);
  }

  const result = Papa.parse<string[]>(text, {
    delimiter: "",
    dynamicTyping: false,
    skipEmptyLines: "greedy",
    transform: (value) => value.trim()
  });

  if (result.errors.length > 0) {
    throw new Error(`Paste input could not be parsed: ${result.errors[0].message}`);
  }

  if (result.meta.delimiter !== "," && result.meta.delimiter !== "\t") {
    throw new Error("Paste input must be CSV or TSV.");
  }

  const firstRow = result.data[0];

  if (!firstRow || firstRow.length === 0) {
    throw new Error("Paste input must contain at least one column.");
  }

  const candidateColumns = tableColumns(firstRow, result.data.slice(1));
  const detectedHeaders = detectColumnMapping(candidateColumns);
  const hasHeader =
    Object.keys(detectedHeaders.mapping).length > 0 ||
    detectedHeaders.ambiguousFields.length > 0;
  const dataRows = hasHeader ? result.data.slice(1) : result.data;
  const columnCount = hasHeader
    ? firstRow.length
    : Math.max(...result.data.map((row) => row.length));
  const rows = paddedRows(dataRows, columnCount);

  if (rows.length > MAX_DRAFT_ROWS) {
    throw new Error(`Paste input cannot contain more than ${MAX_DRAFT_ROWS} rows.`);
  }

  const labels = hasHeader
    ? firstRow.map((label, index) => label || `Column ${index + 1}`)
    : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);

  return {
    columns: tableColumns(labels, rows),
    rows,
    delimiter: result.meta.delimiter,
    hasHeader
  };
}

export function detectColumnMapping(
  columns: readonly PasteColumn[]
): DetectedColumnMapping {
  const mapping: ColumnMapping = {};
  const ambiguousFields: DraftMappableField[] = [];

  for (const field of mappableFields) {
    const matchingColumns = columns.filter((column) =>
      headerFields(column.label).includes(field)
    );

    if (matchingColumns.length === 1) {
      mapping[field] = matchingColumns[0].index;
    } else if (matchingColumns.length > 1) {
      ambiguousFields.push(field);
    }
  }

  return { mapping, ambiguousFields };
}

function cellValue(
  row: readonly string[],
  mapping: ColumnMapping,
  field: DraftMappableField
) {
  const index = mapping[field];
  return index === undefined ? "" : (row[index] ?? "");
}

function nullableCell(
  row: readonly string[],
  mapping: ColumnMapping,
  field: DraftMappableField
) {
  const value = cellValue(row, mapping, field);
  return value === "" ? null : value;
}

function unresolvedReferenceId(
  field: DraftMappableField,
  columnIndex: number | undefined
) {
  const safeColumnIndex =
    typeof columnIndex === "number" &&
    Number.isInteger(columnIndex) &&
    columnIndex >= 0 &&
    columnIndex <= 9_999
      ? columnIndex
      : "unknown";

  return `unresolved:${field}:${safeColumnIndex}`;
}

function ownedNameOrUnresolved(
  value: string | null,
  records: readonly { id: string; name: string }[],
  field: DraftMappableField,
  columnIndex: number | undefined
) {
  if (value === null) {
    return null;
  }

  const matches = records.filter(
    (record) => record.name.toLowerCase() === value.toLowerCase()
  );

  return matches.length === 1
    ? matches[0].id
    : unresolvedReferenceId(field, columnIndex);
}

function transactionType(value: string | null): TransactionDraftInput["type"] {
  if (value === null) {
    return null;
  }

  const aliases: Record<string, TransactionType> = {
    income: "INCOME" as TransactionType,
    "thu nhap": "INCOME" as TransactionType,
    expense: "EXPENSE" as TransactionType,
    "chi tieu": "EXPENSE" as TransactionType,
    transfer: "TRANSFER" as TransactionType,
    "chuyen khoan": "TRANSFER" as TransactionType,
    refund: "REFUND" as TransactionType,
    "hoan tien": "REFUND" as TransactionType,
    adjustment: "ADJUSTMENT" as TransactionType,
    "dieu chinh": "ADJUSTMENT" as TransactionType
  };

  return aliases[normalizeLabel(value)] ?? null;
}

function qualityRating(
  value: string | null
): TransactionDraftInput["qualityRating"] {
  if (value === null) {
    return null;
  }

  const normalized = value.toUpperCase();
  return ["S", "A", "B", "C", "D"].includes(normalized)
    ? (normalized as TransactionDraftInput["qualityRating"])
    : null;
}

function adjustmentDirection(
  value: string | null
): TransactionDraftInput["adjustmentDirection"] {
  if (value === null) {
    return null;
  }

  const aliases = {
    increase: "INCREASE",
    tang: "INCREASE",
    decrease: "DECREASE",
    giam: "DECREASE"
  } as const;

  return (
    aliases[normalizeLabel(value) as keyof typeof aliases] ?? null
  ) as TransactionDraftInput["adjustmentDirection"];
}

function adjustmentTarget(
  value: string | null
): TransactionDraftInput["adjustmentTarget"] {
  if (value === null) {
    return null;
  }

  const aliases = {
    debt: "CREDIT_CARD_DEBT",
    "credit card debt": "CREDIT_CARD_DEBT",
    cardcredit: "CARD_CREDIT",
    "card credit": "CARD_CREDIT",
    credit: "CARD_CREDIT"
  } as const;

  return (
    aliases[normalizeLabel(value) as keyof typeof aliases] ?? null
  ) as TransactionDraftInput["adjustmentTarget"];
}

function rawRowFor(row: readonly string[], columns: readonly PasteColumn[]) {
  const labels = uniqueColumnLabels(columns.map((column) => column.label));
  return Object.fromEntries(labels.map((label, index) => [label, row[index] ?? ""]));
}

export function mapParsedRows(
  table: ParsedTable,
  mapping: ColumnMapping,
  context: PasteMappingContext
): TransactionDraftInput[] {
  return table.rows.map((row, position) => {
    const mappedDate = nullableCell(row, mapping, "transactionDateText");
    const mappedType = nullableCell(row, mapping, "type");
    const mappedCurrency = nullableCell(row, mapping, "currency");
    const mappedQuality = nullableCell(row, mapping, "qualityRating");
    const mappedAdjustmentDirection = nullableCell(
      row,
      mapping,
      "adjustmentDirection"
    );
    const mappedAdjustmentTarget = nullableCell(
      row,
      mapping,
      "adjustmentTarget"
    );
    const parsedQuality = qualityRating(mappedQuality);
    const parsedAdjustmentDirection = adjustmentDirection(
      mappedAdjustmentDirection
    );
    const parsedAdjustmentTarget = adjustmentTarget(mappedAdjustmentTarget);
    const invalidMappedFields: InvalidMappedDraftField[] = [];
    if (mappedQuality !== null && parsedQuality === null) {
      invalidMappedFields.push("qualityRating");
    }
    if (
      mappedAdjustmentDirection !== null &&
      parsedAdjustmentDirection === null
    ) {
      invalidMappedFields.push("adjustmentDirection");
    }
    if (mappedAdjustmentTarget !== null && parsedAdjustmentTarget === null) {
      invalidMappedFields.push("adjustmentTarget");
    }

    return {
      captureKey: context.captureKey,
      position,
      origin: "PASTE" as TransactionDraftInput["origin"],
      type: mappedType === null ? context.defaults.type : transactionType(mappedType),
      amountText: nullableCell(row, mapping, "amountText"),
      currency: mappedCurrency ?? context.defaults.currency,
      title: nullableCell(row, mapping, "title"),
      description: nullableCell(row, mapping, "description"),
      transactionDateText: mappedDate ?? context.defaults.transactionDateText,
      categoryId: ownedNameOrUnresolved(
        nullableCell(row, mapping, "categoryId"),
        context.categories,
        "categoryId",
        mapping.categoryId
      ),
      qualityRating: parsedQuality,
      fromMoneySourceId: ownedNameOrUnresolved(
        nullableCell(row, mapping, "fromMoneySourceId"),
        context.moneySources,
        "fromMoneySourceId",
        mapping.fromMoneySourceId
      ),
      toMoneySourceId: ownedNameOrUnresolved(
        nullableCell(row, mapping, "toMoneySourceId"),
        context.moneySources,
        "toMoneySourceId",
        mapping.toMoneySourceId
      ),
      adjustedMoneySourceId: null,
      adjustmentDirection: parsedAdjustmentDirection,
      adjustmentTarget: parsedAdjustmentTarget,
      projectId: ownedNameOrUnresolved(
        nullableCell(row, mapping, "projectId"),
        context.projects,
        "projectId",
        mapping.projectId
      ),
      relatedTransactionId: nullableCell(row, mapping, "relatedTransactionId"),
      countTowardFeeWaiver: null,
      countTowardFeeWaiverTouched: false,
      qualityRatingTouched: mappedQuality !== null,
      recurringPaymentId: null,
      isInstallmentRelated: false,
      duplicateConfirmed: false,
      duplicateAcknowledgementRequired: false,
      invalidMappedFields,
      rawRow: rawRowFor(row, table.columns)
    };
  });
}
