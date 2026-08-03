import {
  AdjustmentDirection,
  AdjustmentTarget,
  QualityRating,
  TransactionDraftOrigin,
  TransactionType
} from "@prisma/client";
import { z } from "zod";
import type { TransactionCreateData } from "@/lib/transactions/create";

export type DraftField =
  | "type"
  | "amountText"
  | "currency"
  | "title"
  | "transactionDateText"
  | "categoryId"
  | "qualityRating"
  | "fromMoneySourceId"
  | "toMoneySourceId"
  | "adjustedMoneySourceId"
  | "adjustmentDirection"
  | "adjustmentTarget"
  | "projectId"
  | "relatedTransactionId"
  | "countTowardFeeWaiver"
  | "recurringPaymentId"
  | "isInstallmentRelated"
  | "duplicateConfirmed"
  | "description"
  | "form";

export type DraftFieldIssue = {
  field: DraftField;
  message: string;
};

export type TransactionDraftInput = {
  captureKey: string;
  position: number;
  origin: TransactionDraftOrigin;
  type: TransactionType | null;
  amountText: string | null;
  currency: string | null;
  title: string | null;
  description: string | null;
  transactionDateText: string | null;
  categoryId: string | null;
  qualityRating: QualityRating | null;
  fromMoneySourceId: string | null;
  toMoneySourceId: string | null;
  adjustedMoneySourceId: string | null;
  adjustmentDirection: AdjustmentDirection | null;
  adjustmentTarget: AdjustmentTarget | null;
  projectId: string | null;
  relatedTransactionId: string | null;
  countTowardFeeWaiver: boolean | null;
  recurringPaymentId: string | null;
  isInstallmentRelated: boolean;
  duplicateConfirmed: boolean;
  rawRow: Record<string, string> | null;
};

const nullableBounded = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const nullableId = z.string().trim().min(1).max(191).nullable();

export const transactionDraftInputSchema = z
  .object({
    captureKey: z.string().uuid(),
    position: z.number().int().min(0).max(199),
    origin: z.enum(["QUICK", "PASTE"]),
    type: z.nativeEnum(TransactionType).nullable(),
    amountText: nullableBounded(64),
    currency: nullableBounded(8),
    title: nullableBounded(200),
    description: nullableBounded(2_000),
    transactionDateText: nullableBounded(64),
    categoryId: nullableId,
    qualityRating: z.nativeEnum(QualityRating).nullable(),
    fromMoneySourceId: nullableId,
    toMoneySourceId: nullableId,
    adjustedMoneySourceId: nullableId,
    adjustmentDirection: z.nativeEnum(AdjustmentDirection).nullable(),
    adjustmentTarget: z.nativeEnum(AdjustmentTarget).nullable(),
    projectId: nullableId,
    relatedTransactionId: nullableId,
    countTowardFeeWaiver: z.boolean().nullable(),
    recurringPaymentId: nullableId,
    isInstallmentRelated: z.boolean(),
    duplicateConfirmed: z.boolean(),
    rawRow: z.record(z.string(), z.string().max(10_000)).nullable()
  })
  .strict();

export const transactionDraftPatchSchema = transactionDraftInputSchema
  .omit({ captureKey: true, position: true, origin: true })
  .partial()
  .strict();

export type TransactionDraftView = TransactionDraftInput & {
  id: string;
  status: "NEEDS_REVIEW" | "READY" | "IMPORTING" | "IMPORTED" | "DISMISSED";
  confidence: number | null;
  issues: DraftFieldIssue[];
  importBatchId: string | null;
  importedTransactionId: string | null;
  expiresAt: string;
  possibleDuplicate: boolean;
};

export type DraftAssessment = {
  status: "NEEDS_REVIEW" | "READY";
  issues: DraftFieldIssue[];
  input: TransactionCreateData | null;
};
