import { createHash } from "node:crypto";
import {
  AdjustmentTarget,
  type TransactionDraft,
  TransactionType
} from "@prisma/client";
import {
  parseTransactionCreateInput,
  prepareTransactionCreate,
  type OwnedTransactionReferences,
  type TransactionCreateData,
  type TransactionCreateIssue
} from "@/lib/transactions/create";
import type {
  DraftAssessment,
  DraftField,
  DraftFieldIssue,
  TransactionDraftInput,
  TransactionDraftView
} from "@/lib/transaction-drafts/types";

const duplicateIssueMessage =
  "Confirm this possible duplicate before importing.";

const draftFields = new Set<DraftField>([
  "type",
  "amountText",
  "currency",
  "title",
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
  "duplicateConfirmed",
  "description",
  "form"
]);

export function draftToTransactionInput(
  draft: TransactionDraftInput
): Record<string, unknown> {
  return {
    type: draft.type,
    amount: draft.amountText,
    currency: draft.currency ?? undefined,
    title: draft.title,
    description: draft.description,
    transactionDate: draft.transactionDateText,
    categoryId: draft.categoryId,
    qualityRating: draft.qualityRating,
    fromMoneySourceId: draft.fromMoneySourceId,
    toMoneySourceId: draft.toMoneySourceId,
    adjustedMoneySourceId: draft.adjustedMoneySourceId,
    adjustmentDirection: draft.adjustmentDirection,
    adjustmentTarget: draft.adjustmentTarget,
    projectId: draft.projectId,
    relatedTransactionId: draft.relatedTransactionId,
    countTowardFeeWaiver: draft.countTowardFeeWaiver ?? undefined,
    recurringPaymentId: draft.recurringPaymentId,
    isInstallmentRelated: draft.isInstallmentRelated
  };
}

function canonicalProbe(overrides: Record<string, unknown>) {
  return parseTransactionCreateInput({
    type: TransactionType.INCOME,
    amount: "1.00",
    currency: "VND",
    title: "Validation probe",
    transactionDate: "2026-01-01",
    toMoneySourceId: "validation-source",
    ...overrides
  }).ok;
}

function parseFailureIssues(draft: TransactionDraftInput): DraftFieldIssue[] {
  const issues: DraftFieldIssue[] = [];

  if (!draft.type) {
    issues.push({ field: "type", message: "Choose a transaction type." });
  }

  if (
    draft.amountText === null ||
    !canonicalProbe({ amount: draft.amountText })
  ) {
    issues.push({
      field: "amountText",
      message: "Enter a valid positive amount."
    });
  }

  if (draft.currency !== null && !draft.currency.trim()) {
    issues.push({ field: "currency", message: "Enter a currency." });
  }

  if (draft.title === null || !draft.title.trim()) {
    issues.push({ field: "title", message: "Enter a title." });
  }

  if (
    draft.transactionDateText === null ||
    !canonicalProbe({ transactionDate: draft.transactionDateText })
  ) {
    issues.push({
      field: "transactionDateText",
      message: "Enter a valid transaction date."
    });
  }

  return issues;
}

const unresolvedReferenceFields = [
  "categoryId",
  "fromMoneySourceId",
  "toMoneySourceId",
  "adjustedMoneySourceId",
  "projectId",
  "relatedTransactionId",
  "recurringPaymentId"
] as const satisfies readonly DraftField[];

function unresolvedReferenceIssues(
  draft: TransactionDraftInput
): DraftFieldIssue[] {
  return unresolvedReferenceFields.flatMap((field) => {
    const value = draft[field];
    if (
      typeof value !== "string" ||
      !value.trim().startsWith(`unresolved:${field}:`)
    ) {
      return [];
    }

    return [
      {
        field,
        message: field.includes("MoneySource")
          ? "Referenced money source not found."
          : "Referenced record not found."
      }
    ];
  });
}

function transactionFieldToDraftField(
  field: TransactionCreateIssue["field"]
): DraftField {
  if (field === "amount") {
    return "amountText";
  }

  if (field === "transactionDate") {
    return "transactionDateText";
  }

  return draftFields.has(field as DraftField) ? (field as DraftField) : "form";
}

function matrixIssueFields(
  message: string,
  draft: TransactionDraftInput
): DraftField[] {
  switch (message) {
    case "Amount must be positive.":
      return ["amountText"];
    case "Income cannot have a from money source.":
    case "Refund cannot have a from money source.":
      return ["fromMoneySourceId"];
    case "Income requires a to money source.":
    case "Refund requires a to money source.":
      return ["toMoneySourceId"];
    case "Expense requires a from money source.":
      return ["fromMoneySourceId"];
    case "Expense cannot have a to money source.":
      return ["toMoneySourceId"];
    case "Transfer requires both money sources.": {
      const fields: DraftField[] = [];
      if (!draft.fromMoneySourceId) {
        fields.push("fromMoneySourceId");
      }
      if (!draft.toMoneySourceId) {
        fields.push("toMoneySourceId");
      }
      return fields.length > 0 ? fields : ["form"];
    }
    case "Transfer money sources must be different.":
      return ["toMoneySourceId"];
    case "Adjustment cannot have from or to money sources.": {
      const fields: DraftField[] = [];
      if (draft.fromMoneySourceId) {
        fields.push("fromMoneySourceId");
      }
      if (draft.toMoneySourceId) {
        fields.push("toMoneySourceId");
      }
      return fields.length > 0 ? fields : ["form"];
    }
    case "Adjustment requires an adjusted money source.":
      return ["adjustedMoneySourceId"];
    case "Adjustment requires an adjustment direction.":
      return ["adjustmentDirection"];
    case "Adjustment target is only valid for credit cards.":
      return ["adjustmentTarget"];
    case "Adjustment fields are only valid for adjustments.": {
      const fields: DraftField[] = [];
      if (draft.adjustedMoneySourceId) {
        fields.push("adjustedMoneySourceId");
      }
      if (draft.adjustmentDirection) {
        fields.push("adjustmentDirection");
      }
      if (draft.adjustmentTarget) {
        fields.push("adjustmentTarget");
      }
      return fields.length > 0 ? fields : ["form"];
    }
    case "Quality rating is only valid for expenses.":
      return ["qualityRating"];
    case "Related transaction is only valid for refunds.":
      return ["relatedTransactionId"];
    default:
      return ["form"];
  }
}

function canonicalIssuesToDraftIssues(
  issues: readonly TransactionCreateIssue[],
  draft: TransactionDraftInput
) {
  return issues.flatMap((issue): DraftFieldIssue[] => {
    const fields =
      issue.field === "form"
        ? matrixIssueFields(issue.message, draft)
        : [transactionFieldToDraftField(issue.field)];

    return fields.map((field) => ({ field, message: issue.message }));
  });
}

function withDuplicateFinding(
  draft: TransactionDraftInput,
  issues: DraftFieldIssue[],
  possibleDuplicate: boolean
) {
  if (possibleDuplicate && !draft.duplicateConfirmed) {
    return [
      ...issues,
      { field: "form" as const, message: duplicateIssueMessage }
    ];
  }

  return issues;
}

function normalizedCreateData(
  parsed: TransactionCreateData,
  prepared: ReturnType<typeof prepareTransactionCreate> & { ok: true }
): TransactionCreateData {
  return {
    ...parsed,
    adjustmentTarget:
      prepared.data.transaction.adjustmentTarget === null
        ? null
        : (prepared.data.transaction.adjustmentTarget as AdjustmentTarget),
    countTowardFeeWaiver: prepared.data.transaction.countTowardFeeWaiver
  };
}

export function assessDraft(
  draft: TransactionDraftInput,
  references: OwnedTransactionReferences,
  context: { possibleDuplicate: boolean } = { possibleDuplicate: false }
): DraftAssessment {
  const parsed = parseTransactionCreateInput(draftToTransactionInput(draft));

  if (!parsed.ok) {
    const fieldIssues = parseFailureIssues(draft);
    const referenceIssues = unresolvedReferenceIssues(draft);
    const issues = withDuplicateFinding(
      draft,
      [
        ...(fieldIssues.length > 0
          ? fieldIssues
          : canonicalIssuesToDraftIssues(parsed.issues, draft)),
        ...referenceIssues
      ],
      context.possibleDuplicate
    );
    return { status: "NEEDS_REVIEW", issues, input: null };
  }

  const prepared = prepareTransactionCreate(parsed.data, references);
  if (!prepared.ok) {
    return {
      status: "NEEDS_REVIEW",
      issues: withDuplicateFinding(
        draft,
        canonicalIssuesToDraftIssues(prepared.issues, draft),
        context.possibleDuplicate
      ),
      input: null
    };
  }

  const issues = withDuplicateFinding(
    draft,
    [],
    context.possibleDuplicate
  );
  if (issues.length > 0) {
    return { status: "NEEDS_REVIEW", issues, input: null };
  }

  return {
    status: "READY",
    issues: [],
    input: normalizedCreateData(parsed.data, prepared)
  };
}

function normalizeIdentityText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function applicableSourceIds(draft: TransactionDraftInput): string[] | null {
  switch (draft.type) {
    case TransactionType.INCOME:
    case TransactionType.REFUND:
      return draft.toMoneySourceId ? [draft.toMoneySourceId.trim()] : null;
    case TransactionType.EXPENSE:
      return draft.fromMoneySourceId
        ? [draft.fromMoneySourceId.trim()]
        : null;
    case TransactionType.TRANSFER:
      return draft.fromMoneySourceId && draft.toMoneySourceId
        ? [draft.fromMoneySourceId.trim(), draft.toMoneySourceId.trim()]
        : null;
    case TransactionType.ADJUSTMENT:
      return draft.adjustedMoneySourceId
        ? [draft.adjustedMoneySourceId.trim()]
        : null;
    default:
      return null;
  }
}

export function computeDraftFingerprint(
  draft: TransactionDraftInput
): string | null {
  if (
    !draft.type ||
    !draft.amountText?.trim() ||
    !draft.transactionDateText?.trim() ||
    !draft.title?.trim()
  ) {
    return null;
  }

  const sourceIds = applicableSourceIds(draft);
  if (!sourceIds) {
    return null;
  }

  const identity = JSON.stringify([
    draft.type,
    draft.amountText.trim(),
    draft.transactionDateText.trim(),
    normalizeIdentityText(draft.title),
    sourceIds
  ]);

  return createHash("sha256").update(identity, "utf8").digest("hex");
}

export function findDuplicateDraftPositions(
  drafts: readonly TransactionDraftInput[]
): Set<number> {
  const captureKey = drafts[0]?.captureKey;
  if (drafts.some((draft) => draft.captureKey !== captureKey)) {
    throw new Error("Drafts must belong to one capture session.");
  }

  const seen = new Set<string>();
  const duplicatePositions = new Set<number>();

  for (const draft of [...drafts].sort(
    (left, right) => left.position - right.position
  )) {
    const fingerprint = computeDraftFingerprint(draft);
    if (!fingerprint) {
      continue;
    }

    if (seen.has(fingerprint)) {
      duplicatePositions.add(draft.position);
    } else {
      seen.add(fingerprint);
    }
  }

  return duplicatePositions;
}

function rawRowFromJson(value: TransactionDraft["rawRow"]) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.some(([, entryValue]) => typeof entryValue !== "string")) {
    return null;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function issuesFromJson(value: TransactionDraft["validationIssues"]) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate): DraftFieldIssue[] => {
    if (
      !candidate ||
      Array.isArray(candidate) ||
      typeof candidate !== "object"
    ) {
      return [];
    }

    const field = "field" in candidate ? candidate.field : undefined;
    const message = "message" in candidate ? candidate.message : undefined;
    return typeof field === "string" &&
      draftFields.has(field as DraftField) &&
      typeof message === "string"
      ? [{ field: field as DraftField, message }]
      : [];
  });
}

export function transactionDraftRecordToInput(
  draft: TransactionDraft
): TransactionDraftInput {
  return {
    captureKey: draft.captureKey,
    position: draft.position,
    origin: draft.origin,
    type: draft.type,
    amountText: draft.amountText,
    currency: draft.currency,
    title: draft.title,
    description: draft.description,
    transactionDateText: draft.transactionDateText,
    categoryId: draft.categoryId,
    qualityRating: draft.qualityRating,
    fromMoneySourceId: draft.fromMoneySourceId,
    toMoneySourceId: draft.toMoneySourceId,
    adjustedMoneySourceId: draft.adjustedMoneySourceId,
    adjustmentDirection: draft.adjustmentDirection,
    adjustmentTarget: draft.adjustmentTarget,
    projectId: draft.projectId,
    relatedTransactionId: draft.relatedTransactionId,
    countTowardFeeWaiver: draft.countTowardFeeWaiver,
    recurringPaymentId: draft.recurringPaymentId,
    isInstallmentRelated: draft.isInstallmentRelated,
    duplicateConfirmed: draft.duplicateConfirmed,
    rawRow: rawRowFromJson(draft.rawRow)
  };
}

export function transactionDraftRecordToView(
  draft: TransactionDraft
): TransactionDraftView {
  const issues = issuesFromJson(draft.validationIssues);

  return {
    ...transactionDraftRecordToInput(draft),
    id: draft.id,
    status: draft.status,
    confidence: draft.confidence,
    issues,
    importBatchId: draft.importBatchId,
    importedTransactionId: draft.importedTransactionId,
    expiresAt: draft.expiresAt.toISOString(),
    possibleDuplicate: issues.some(
      ({ field, message }) =>
        field === "form" && message === duplicateIssueMessage
    )
  };
}
