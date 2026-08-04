"use server";

import {
  Prisma,
  TransactionDraftOrigin,
  TransactionDraftStatus,
  type TransactionDraft
} from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
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
  type TransactionCreateData
} from "@/lib/transactions/create";

const DRAFT_RETENTION_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
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

export type DraftActionResult<
  T extends object = Record<string, never>
> =
  | ({ ok: true } & T)
  | { ok: false; error: string; draftId?: string };

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
      if (!merged.success || !hasBoundedRawRows([merged.data])) {
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
