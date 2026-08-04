"use server";

import {
  Prisma,
  TransactionDraftOrigin,
  TransactionDraftStatus,
  type TransactionDraft,
  type TransactionImportBatch
} from "@prisma/client";
import { z } from "zod";
import { transactionBatchImportedMetadata } from "@/lib/activity";
import { requireAuth } from "@/lib/auth";
import { runSerializable } from "@/lib/db/serializable";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";
import { MAX_DRAFT_ROWS, MAX_PASTE_BYTES } from "@/lib/transaction-drafts/paste";
import { cleanupExpiredTransactionDrafts } from "@/lib/transaction-drafts/retention";
import {
  transactionDraftInputSchema,
  transactionDraftPatchSchema,
  type DraftFieldIssue,
  type TransactionDraftInput,
  type TransactionDraftView
} from "@/lib/transaction-drafts/types";
import {
  assessDraft,
  computeDraftFingerprint,
  draftToTransactionInput,
  findDuplicateDraftPositions,
  transactionDraftRecordToInput,
  transactionDraftRecordToView
} from "@/lib/transaction-drafts/validation";
import {
  loadOwnedTransactionReferences,
  parseTransactionCreateInput,
  persistPreparedTransactions,
  prepareTransactionCreate,
  type TransactionCreateData
} from "@/lib/transactions/create";

const DRAFT_RETENTION_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const IMPORT_TRANSACTION_TIMEOUT_MS = 60_000;
const INVALID_DRAFT_ERROR = "Enter valid draft data.";
const DRAFT_NOT_FOUND_ERROR = "Draft not found.";

const saveDraftsSchema = z
  .object({
    captureKey: z.string().uuid(),
    rows: z.array(transactionDraftInputSchema).min(1).max(MAX_DRAFT_ROWS)
  })
  .strict()
  .superRefine(({ captureKey, rows }, context) => {
    rows.forEach((row, index) => {
      if (
        row.captureKey !== captureKey ||
        row.origin !== TransactionDraftOrigin.PASTE ||
        row.position !== index
      ) {
        context.addIssue({
          code: "custom",
          path: ["rows", index],
          message:
            "Paste rows must belong to this capture and use contiguous positions."
        });
      }
    });
  });

const quickDraftSchema = transactionDraftInputSchema.superRefine(
  (row, context) => {
    if (row.origin !== TransactionDraftOrigin.QUICK || row.position !== 0) {
      context.addIssue({
        code: "custom",
        message: "Quick captures must contain one quick draft at position zero."
      });
    }
  }
);
const captureKeySchema = z.string().uuid();
const draftIdSchema = z.string().trim().min(1).max(191);
const dismissIdsSchema = z.array(draftIdSchema).max(MAX_DRAFT_ROWS);
const importDraftsSchema = z
  .object({
    ids: z
      .array(z.string().cuid())
      .min(1)
      .max(MAX_DRAFT_ROWS)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each draft once."
      ),
    idempotencyKey: z.string().uuid()
  })
  .strict();
const storedIdsSchema = z.array(z.string()).max(MAX_DRAFT_ROWS);

export type DraftActionResult<
  T extends object = Record<string, never>
> =
  | ({ ok: true } & T)
  | { ok: false; error: string; draftId?: string };

export type ImportTransactionDraftsInput = {
  ids: readonly string[];
  idempotencyKey: string;
};

export type ImportTransactionDraftsResult = DraftActionResult<{
  transactionIds: string[];
  importedCount: number;
}>;

function rawRowsUtf8Size(rows: readonly TransactionDraftInput[]) {
  const serialized = JSON.stringify(rows.map(({ rawRow }) => rawRow));
  return new TextEncoder().encode(serialized).byteLength;
}

function hasBoundedRawRows(rows: readonly TransactionDraftInput[]) {
  return rawRowsUtf8Size(rows) <= MAX_PASTE_BYTES;
}

function jsonValue(value: Record<string, string> | null) {
  return value === null ? Prisma.DbNull : value;
}

function storedDraftData(input: TransactionDraftInput) {
  return {
    type: input.type,
    amountText: input.amountText,
    currency: input.currency,
    title: input.title,
    description: input.description,
    transactionDateText: input.transactionDateText,
    categoryId: input.categoryId,
    qualityRating: input.qualityRating,
    fromMoneySourceId: input.fromMoneySourceId,
    toMoneySourceId: input.toMoneySourceId,
    adjustedMoneySourceId: input.adjustedMoneySourceId,
    adjustmentDirection: input.adjustmentDirection,
    adjustmentTarget: input.adjustmentTarget,
    projectId: input.projectId,
    relatedTransactionId: input.relatedTransactionId,
    countTowardFeeWaiver: input.countTowardFeeWaiver,
    recurringPaymentId: input.recurringPaymentId,
    isInstallmentRelated: input.isInstallmentRelated,
    duplicateConfirmed: input.duplicateConfirmed,
    rawRow: jsonValue(input.rawRow),
    status: TransactionDraftStatus.NEEDS_REVIEW,
    duplicateFingerprint: null,
    validationIssues: []
  } satisfies Prisma.TransactionDraftUncheckedUpdateInput;
}

function invalidStoredDraftIssue(): DraftFieldIssue[] {
  return [{ field: "form", message: "Review this draft before importing." }];
}

async function reassessCapture(
  db: Prisma.TransactionClient,
  userId: string,
  captureKey: string
): Promise<TransactionDraft[]> {
  const records = await db.transactionDraft.findMany({
    where: {
      userId,
      captureKey,
      status: {
        in: [
          TransactionDraftStatus.NEEDS_REVIEW,
          TransactionDraftStatus.READY
        ]
      }
    },
    orderBy: [{ position: "asc" }, { id: "asc" }]
  });
  const parsedInputs = records.map((record) =>
    transactionDraftInputSchema.safeParse(transactionDraftRecordToInput(record))
  );
  const validInputs = parsedInputs.flatMap((result) =>
    result.success ? [result.data] : []
  );
  const duplicatePositions = findDuplicateDraftPositions(validInputs);
  const canonicalInputs: TransactionCreateData[] = validInputs.flatMap((draft) => {
    const parsed = parseTransactionCreateInput(draftToTransactionInput(draft));
    return parsed.ok ? [parsed.data] : [];
  });
  const references = await loadOwnedTransactionReferences(
    db,
    userId,
    canonicalInputs
  );

  await Promise.all(
    records.map((record, index) => {
      const parsed = parsedInputs[index];
      const assessment = parsed.success
        ? assessDraft(parsed.data, references, {
            possibleDuplicate: duplicatePositions.has(parsed.data.position)
          })
        : {
            status: TransactionDraftStatus.NEEDS_REVIEW,
            issues: invalidStoredDraftIssue()
          };
      const duplicateFingerprint = parsed.success
        ? computeDraftFingerprint(parsed.data)
        : null;

      return db.transactionDraft.update({
        where: { id: record.id, userId },
        data: {
          status: assessment.status,
          validationIssues: assessment.issues,
          duplicateFingerprint
        }
      });
    })
  );

  return db.transactionDraft.findMany({
    where: { userId, captureKey },
    orderBy: [{ position: "asc" }, { id: "asc" }]
  });
}

async function mutationAllowed(userId: string) {
  const decision = await checkAuthenticatedMutation(userId);
  return decision.allowed && !decision.unavailable;
}

function actionFailure(error = INVALID_DRAFT_ERROR): {
  ok: false;
  error: string;
  draftId?: string;
} {
  return { ok: false, error };
}

function readStoredIds(value: Prisma.JsonValue) {
  return storedIdsSchema.parse(value);
}

function sameIdSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function completedBatchResult(
  batch: TransactionImportBatch
): ImportTransactionDraftsResult {
  const transactionIds = readStoredIds(batch.transactionIds);
  return {
    ok: true,
    transactionIds,
    importedCount: transactionIds.length
  };
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function savePasteDrafts(input: {
  captureKey: string;
  rows: readonly unknown[];
}): Promise<DraftActionResult<{ drafts: TransactionDraftView[] }>> {
  const user = await requireAuth();
  if (!(await mutationAllowed(user.id))) {
    return actionFailure(RATE_LIMIT_MESSAGE);
  }

  const parsed = saveDraftsSchema.safeParse(input);
  if (!parsed.success || !hasBoundedRawRows(parsed.data.rows)) {
    return actionFailure();
  }

  try {
    const records = await prisma.$transaction(async (db) => {
      const createdAt = new Date();
      const expiresAt = new Date(
        createdAt.getTime() + DRAFT_RETENTION_DAYS * MILLISECONDS_PER_DAY
      );

      for (const row of parsed.data.rows) {
        await db.transactionDraft.upsert({
          where: {
            userId_captureKey_position: {
              userId: user.id,
              captureKey: parsed.data.captureKey,
              position: row.position
            }
          },
          create: {
            userId: user.id,
            captureKey: row.captureKey,
            position: row.position,
            origin: row.origin,
            createdAt,
            expiresAt,
            ...storedDraftData(row)
          },
          update: { ...storedDraftData(row), origin: row.origin }
        });
      }

      await db.transactionDraft.deleteMany({
        where: {
          userId: user.id,
          captureKey: parsed.data.captureKey,
          origin: TransactionDraftOrigin.PASTE,
          position: { gte: parsed.data.rows.length }
        }
      });

      return reassessCapture(db, user.id, parsed.data.captureKey);
    });

    return { ok: true, drafts: records.map(transactionDraftRecordToView) };
  } catch {
    return actionFailure();
  }
}

export async function saveQuickDraft(
  input: unknown
): Promise<DraftActionResult<{ draft: TransactionDraftView }>> {
  const user = await requireAuth();
  if (!(await mutationAllowed(user.id))) {
    return actionFailure(RATE_LIMIT_MESSAGE);
  }

  const parsed = quickDraftSchema.safeParse(input);
  if (!parsed.success || !hasBoundedRawRows([parsed.data])) {
    return actionFailure();
  }

  try {
    const records = await prisma.$transaction(async (db) => {
      const createdAt = new Date();
      const expiresAt = new Date(
        createdAt.getTime() + DRAFT_RETENTION_DAYS * MILLISECONDS_PER_DAY
      );
      await db.transactionDraft.upsert({
        where: {
          userId_captureKey_position: {
            userId: user.id,
            captureKey: parsed.data.captureKey,
            position: parsed.data.position
          }
        },
        create: {
          userId: user.id,
          captureKey: parsed.data.captureKey,
          position: parsed.data.position,
          origin: parsed.data.origin,
          createdAt,
          expiresAt,
          ...storedDraftData(parsed.data)
        },
        update: { ...storedDraftData(parsed.data), origin: parsed.data.origin }
      });
      return reassessCapture(db, user.id, parsed.data.captureKey);
    });
    const draft = records.find(({ position }) => position === parsed.data.position);
    return draft
      ? { ok: true, draft: transactionDraftRecordToView(draft) }
      : actionFailure();
  } catch {
    return actionFailure();
  }
}

function cleanupErrorClass(error: unknown) {
  return error instanceof Error ? error.constructor.name : "UnknownError";
}

export async function listTransactionDrafts(
  captureKey: string
): Promise<DraftActionResult<{ drafts: TransactionDraftView[] }>> {
  const user = await requireAuth();
  const parsedCaptureKey = captureKeySchema.safeParse(captureKey);
  if (!parsedCaptureKey.success) {
    return actionFailure();
  }

  try {
    await cleanupExpiredTransactionDrafts();
  } catch (error) {
    console.error("Transaction draft retention cleanup failed.", {
      errorClass: cleanupErrorClass(error)
    });
  }

  try {
    const records = await prisma.transactionDraft.findMany({
      where: { userId: user.id, captureKey: parsedCaptureKey.data },
      orderBy: [{ position: "asc" }, { id: "asc" }]
    });
    return { ok: true, drafts: records.map(transactionDraftRecordToView) };
  } catch {
    return actionFailure();
  }
}

export async function updateTransactionDraft(
  id: string,
  patch: unknown
): Promise<DraftActionResult<{ draft: TransactionDraftView }>> {
  const user = await requireAuth();
  if (!(await mutationAllowed(user.id))) {
    return actionFailure(RATE_LIMIT_MESSAGE);
  }
  const parsedId = draftIdSchema.safeParse(id);
  const parsedPatch = transactionDraftPatchSchema.safeParse(patch);
  if (!parsedId.success || !parsedPatch.success) {
    return actionFailure();
  }

  try {
    return await prisma.$transaction(async (db) => {
      const existing = await db.transactionDraft.findFirst({
        where: { id: parsedId.data, userId: user.id }
      });
      if (!existing) {
        return actionFailure(DRAFT_NOT_FOUND_ERROR);
      }

      const merged = transactionDraftInputSchema.safeParse({
        ...transactionDraftRecordToInput(existing),
        ...parsedPatch.data
      });
      if (!merged.success) {
        return actionFailure();
      }
      const captureRecords = await db.transactionDraft.findMany({
        where: { userId: user.id, captureKey: existing.captureKey },
        orderBy: [{ position: "asc" }, { id: "asc" }]
      });
      const captureInputs = captureRecords.map((record) =>
        record.id === existing.id
          ? merged.data
          : transactionDraftRecordToInput(record)
      );
      if (!hasBoundedRawRows(captureInputs)) {
        return actionFailure();
      }

      await db.transactionDraft.update({
        where: { id: existing.id, userId: user.id },
        data: storedDraftData(merged.data)
      });
      const records = await reassessCapture(
        db,
        user.id,
        existing.captureKey
      );
      const updated = records.find((record) => record.id === existing.id);
      return updated
        ? { ok: true as const, draft: transactionDraftRecordToView(updated) }
        : actionFailure();
    });
  } catch {
    return actionFailure();
  }
}

const dismissedCandidateData = {
  status: TransactionDraftStatus.DISMISSED,
  confidence: null,
  type: null,
  amountText: null,
  currency: null,
  title: null,
  description: null,
  transactionDateText: null,
  categoryId: null,
  qualityRating: null,
  fromMoneySourceId: null,
  toMoneySourceId: null,
  adjustedMoneySourceId: null,
  adjustmentDirection: null,
  adjustmentTarget: null,
  projectId: null,
  relatedTransactionId: null,
  countTowardFeeWaiver: null,
  recurringPaymentId: null,
  isInstallmentRelated: false,
  duplicateFingerprint: null,
  duplicateConfirmed: false,
  validationIssues: [],
  rawRow: Prisma.DbNull
} satisfies Prisma.TransactionDraftUncheckedUpdateManyInput;

function activityOrigin(records: readonly Pick<TransactionDraft, "origin">[]) {
  const origins = new Set(records.map(({ origin }) => origin));
  return origins.size === 1 ? records[0].origin : "MIXED";
}

export async function dismissTransactionDrafts(
  ids: readonly string[]
): Promise<DraftActionResult<{ dismissedCount: number }>> {
  const user = await requireAuth();
  if (!(await mutationAllowed(user.id))) {
    return actionFailure(RATE_LIMIT_MESSAGE);
  }
  const parsedIds = dismissIdsSchema.safeParse(ids);
  if (!parsedIds.success) {
    return actionFailure();
  }
  const uniqueIds = Array.from(new Set(parsedIds.data));
  if (uniqueIds.length === 0) {
    return { ok: true, dismissedCount: 0 };
  }

  try {
    const dismissedCount = await prisma.$transaction(async (db) => {
      const owned = await db.transactionDraft.findMany({
        where: { userId: user.id, id: { in: uniqueIds } },
        select: { id: true, origin: true }
      });
      if (owned.length === 0) {
        return 0;
      }
      const ownedIds = owned.map(({ id }) => id);
      const dismissed = await db.transactionDraft.updateMany({
        where: { userId: user.id, id: { in: ownedIds } },
        data: dismissedCandidateData
      });
      await db.activityLog.create({
        data: {
          userId: user.id,
          action: "TRANSACTION_DRAFTS_DISMISSED",
          entityType: "TransactionDraft",
          metadata: {
            count: dismissed.count,
            origin: activityOrigin(owned)
          }
        }
      });
      return dismissed.count;
    });
    return { ok: true, dismissedCount };
  } catch {
    return actionFailure();
  }
}

export async function importTransactionDrafts(
  input: ImportTransactionDraftsInput
): Promise<ImportTransactionDraftsResult> {
  const user = await requireAuth();
  if (!(await mutationAllowed(user.id))) {
    return actionFailure(RATE_LIMIT_MESSAGE);
  }

  const parsedInput = importDraftsSchema.safeParse(input);
  if (!parsedInput.success) {
    return actionFailure(parsedInput.error.issues[0].message);
  }
  const { ids, idempotencyKey } = parsedInput.data;

  try {
    return await runSerializable(async (db) => {
      const replay = await db.transactionImportBatch.findUnique({
        where: {
          userId_idempotencyKey: { userId: user.id, idempotencyKey }
        }
      });
      if (replay) {
        if (!sameIdSet(readStoredIds(replay.draftIds), ids)) {
          return actionFailure(
            "This save key was already used for another selection."
          );
        }
        return replay.status === "IMPORTED"
          ? completedBatchResult(replay)
          : actionFailure("This selection is already being saved.");
      }

      const drafts = await db.transactionDraft.findMany({
        where: {
          id: { in: ids },
          userId: user.id,
          status: TransactionDraftStatus.READY
        },
        orderBy: [{ position: "asc" }, { id: "asc" }]
      });
      if (drafts.length !== ids.length) {
        return actionFailure("Review every selected draft before saving.");
      }

      const origin = drafts[0].origin;
      if (drafts.some((draft) => draft.origin !== origin)) {
        return actionFailure("Save QUICK and PASTE drafts in separate batches.");
      }

      const parsedRows = drafts.map((draft) => ({
        draft,
        parsed: parseTransactionCreateInput(
          draftToTransactionInput(transactionDraftRecordToInput(draft))
        )
      }));
      const invalid = parsedRows.find(({ parsed }) => !parsed.ok);
      if (invalid && !invalid.parsed.ok) {
        return {
          ok: false,
          error: invalid.parsed.issues[0].message,
          draftId: invalid.draft.id
        };
      }

      const data = parsedRows.flatMap(({ parsed }) =>
        parsed.ok ? [parsed.data] : []
      );
      const references = await loadOwnedTransactionReferences(db, user.id, data);
      const preparedRows = data.map((row, index) => ({
        draft: drafts[index],
        prepared: prepareTransactionCreate(row, references)
      }));
      const rejected = preparedRows.find(({ prepared }) => !prepared.ok);
      if (rejected && !rejected.prepared.ok) {
        return {
          ok: false,
          error: rejected.prepared.issues[0].message,
          draftId: rejected.draft.id
        };
      }
      const prepared = preparedRows.map(({ prepared }) => {
        if (!prepared.ok) {
          throw new Error("Prepared draft invariant failed.");
        }
        return prepared.data;
      });

      const batch = await db.transactionImportBatch.create({
        data: {
          userId: user.id,
          idempotencyKey,
          origin,
          draftIds: ids
        }
      });
      const locked = await db.transactionDraft.updateMany({
        where: {
          id: { in: ids },
          userId: user.id,
          status: TransactionDraftStatus.READY
        },
        data: {
          status: TransactionDraftStatus.IMPORTING,
          importBatchId: batch.id
        }
      });
      if (locked.count !== ids.length) {
        throw new Error("Drafts changed while saving.");
      }

      const transactions = await persistPreparedTransactions(
        db,
        user.id,
        prepared
      );
      const transactionIds = transactions.map(({ id }) => id);

      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        const transaction = transactions[index];
        if (!draft || !transaction) {
          throw new Error("Persisted transaction invariant failed.");
        }
        await db.transactionDraft.update({
          where: {
            id: draft.id,
            userId: user.id,
            status: TransactionDraftStatus.IMPORTING,
            importBatchId: batch.id
          },
          data: {
            status: TransactionDraftStatus.IMPORTED,
            importBatchId: batch.id,
            importedTransactionId: transaction.id,
            confidence: null,
            type: null,
            amountText: null,
            currency: null,
            title: null,
            description: null,
            transactionDateText: null,
            categoryId: null,
            qualityRating: null,
            fromMoneySourceId: null,
            toMoneySourceId: null,
            adjustedMoneySourceId: null,
            adjustmentDirection: null,
            adjustmentTarget: null,
            projectId: null,
            relatedTransactionId: null,
            countTowardFeeWaiver: null,
            recurringPaymentId: null,
            isInstallmentRelated: false,
            duplicateFingerprint: null,
            duplicateConfirmed: false,
            validationIssues: [],
            rawRow: Prisma.DbNull
          }
        });
      }

      await db.activityLog.create({
        data: {
          userId: user.id,
          action: "TRANSACTION_BATCH_IMPORTED",
          entityType: "TransactionImportBatch",
          entityId: batch.id,
          metadata: transactionBatchImportedMetadata(
            origin,
            transactionIds.length
          )
        }
      });
      const completed = await db.transactionImportBatch.update({
        where: { id: batch.id, userId: user.id },
        data: {
          status: "IMPORTED",
          transactionIds
        }
      });
      return completedBatchResult(completed);
    }, undefined, IMPORT_TRANSACTION_TIMEOUT_MS);
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }

    const replay = await prisma.transactionImportBatch.findUnique({
      where: {
        userId_idempotencyKey: { userId: user.id, idempotencyKey }
      }
    });
    if (
      !replay ||
      replay.status !== "IMPORTED" ||
      !sameIdSet(readStoredIds(replay.draftIds), ids)
    ) {
      return actionFailure(
        "This save key was already used for another selection."
      );
    }
    return completedBatchResult(replay);
  }
}
