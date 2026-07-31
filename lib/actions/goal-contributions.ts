"use server";

import {
  ContributionType,
  Prisma,
  TransactionType
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  goalContributionCreatedMetadata,
  goalContributionUpdatedMetadata
} from "@/lib/activity";
import {
  overContributionError,
  validateContributionAgainstTransaction
} from "@/lib/calc/goals";
import { runSerializable } from "@/lib/db/serializable";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const optionalTextSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  if (value === "on" || value === "true" || value === true) {
    return true;
  }

  if (value === "false" || value === false) {
    return false;
  }

  return value;
}, z.boolean().default(false));

const maxDecimal18WithScale2 = new Prisma.Decimal("9999999999999999.99");
const positiveDecimalSchema = z
  .union([z.string(), z.instanceof(Prisma.Decimal)])
  .transform((value, context) => {
    const text = typeof value === "string" ? value.trim() : value.toString();
    let amount: Prisma.Decimal;

    try {
      amount = new Prisma.Decimal(text);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a valid decimal amount."
      });
      return z.NEVER;
    }

    if (
      !text ||
      !amount.isFinite() ||
      !amount.greaterThan(0) ||
      amount.decimalPlaces() > 2 ||
      amount.greaterThan(maxDecimal18WithScale2)
    ) {
      context.addIssue({
        code: "custom",
        message: "Amount must be a positive Decimal(18,2) value."
      });
      return z.NEVER;
    }

    return text;
  });

const contributionSchema = z.object({
  savingGoalId: z.string().trim().min(1),
  transactionId: optionalIdSchema,
  fromMoneySourceId: optionalIdSchema,
  amount: positiveDecimalSchema,
  type: z.nativeEnum(ContributionType),
  isManualAdjustment: optionalBooleanSchema,
  note: optionalTextSchema,
  contributionDate: z.coerce.date()
});

const contributionUpdateSchema = contributionSchema.partial();

type ContributionInput = z.input<typeof contributionSchema>;
type ContributionUpdateInput = z.input<typeof contributionUpdateSchema>;
type ContributionData = z.infer<typeof contributionSchema>;

export type GoalContributionActionResult = {
  ok: boolean;
  error?: string;
};

const contributionSaveError =
  "Unable to save contribution. Please try again.";
const withdrawalTransactionError =
  "Withdrawals cannot link to an income transaction.";

function formValue(formData: FormData, key: string) {
  return formData.get(key) ?? undefined;
}

function parseContributionInput(data: ContributionInput | FormData) {
  if (data instanceof FormData) {
    return contributionSchema.safeParse({
      savingGoalId: formValue(data, "savingGoalId"),
      transactionId: formValue(data, "transactionId"),
      fromMoneySourceId: formValue(data, "fromMoneySourceId"),
      amount: formValue(data, "amount"),
      type: formValue(data, "type"),
      isManualAdjustment: formValue(data, "isManualAdjustment"),
      note: formValue(data, "note"),
      contributionDate: formValue(data, "contributionDate")
    });
  }

  return contributionSchema.safeParse(data);
}

function parseContributionUpdateInput(data: ContributionUpdateInput | FormData) {
  if (data instanceof FormData) {
    return contributionUpdateSchema.safeParse({
      savingGoalId: formValue(data, "savingGoalId"),
      transactionId: formValue(data, "transactionId"),
      fromMoneySourceId: formValue(data, "fromMoneySourceId"),
      amount: formValue(data, "amount"),
      type: formValue(data, "type"),
      isManualAdjustment: formValue(data, "isManualAdjustment"),
      note: formValue(data, "note"),
      contributionDate: formValue(data, "contributionDate")
    });
  }

  return contributionUpdateSchema.safeParse(data);
}

function cleanContributionCreateData(data: ContributionData & { userId: string }) {
  return {
    ...data,
    transactionId:
      data.type === ContributionType.WITHDRAWAL
        ? null
        : data.transactionId ?? null,
    fromMoneySourceId: data.fromMoneySourceId ?? null,
    note: data.note ?? null
  };
}

function cleanContributionUpdateData(
  data: ContributionData & { userId: string }
) {
  return {
    ...data,
    transactionId:
      data.type === ContributionType.WITHDRAWAL
        ? null
        : data.transactionId ?? null,
    fromMoneySourceId: data.fromMoneySourceId ?? null,
    note: data.note ?? null
  };
}

async function verifyGoalOwnership(
  db: Prisma.TransactionClient,
  id: string,
  userId: string
) {
  const goal = await db.savingGoal.findFirst({
    where: { id, userId },
    select: { id: true, name: true }
  });

  if (!goal) {
    throw new Error("Saving goal not found.");
  }

  return goal;
}

async function verifyContributionOwnership(
  db: Prisma.TransactionClient,
  id: string,
  userId: string
) {
  const contribution = await db.goalContribution.findFirst({
    where: { id, userId }
  });

  if (!contribution) {
    throw new Error("Goal contribution not found.");
  }

  return contribution;
}

async function verifyOptionalTransaction(
  db: Prisma.TransactionClient,
  id: string | undefined,
  userId: string
) {
  if (!id) {
    return null;
  }

  const transaction = await db.transaction.findFirst({
    where: { id, userId, type: TransactionType.INCOME },
    select: { id: true, amount: true, title: true, type: true }
  });

  if (!transaction) {
    throw new Error("Referenced transaction not found.");
  }

  return transaction;
}

async function verifyOptionalMoneySource(
  db: Prisma.TransactionClient,
  id: string | undefined,
  userId: string
) {
  if (!id) {
    return null;
  }

  const moneySource = await db.moneySource.findFirst({
    where: { id, userId },
    select: { id: true, name: true }
  });

  if (!moneySource) {
    throw new Error("Referenced money source not found.");
  }

  return moneySource;
}

async function verifyReferences(
  db: Prisma.TransactionClient,
  data: Pick<
    ContributionData,
    "fromMoneySourceId" | "savingGoalId" | "transactionId"
  >,
  userId: string
) {
  const [goal, transaction, moneySource] = await Promise.all([
    verifyGoalOwnership(db, data.savingGoalId, userId),
    verifyOptionalTransaction(db, data.transactionId, userId),
    verifyOptionalMoneySource(db, data.fromMoneySourceId, userId)
  ]);

  return { goal, transaction, moneySource };
}

async function validateLinkedTransactionLimit(
  db: Prisma.TransactionClient,
  data: ContributionData & { userId: string },
  excludeContributionId?: string
) {
  if (!data.transactionId || data.isManualAdjustment) {
    return { ok: true };
  }

  const transaction = await db.transaction.findFirst({
    where: {
      id: data.transactionId,
      userId: data.userId,
      type: TransactionType.INCOME
    },
    select: { amount: true }
  });

  if (!transaction) {
    return { ok: false, error: "Referenced transaction not found." };
  }

  const existing = await db.goalContribution.aggregate({
    where: {
      transactionId: data.transactionId,
      userId: data.userId,
      type: ContributionType.CONTRIBUTION,
      ...(excludeContributionId ? { id: { not: excludeContributionId } } : {})
    },
    _sum: { amount: true }
  });

  return validateContributionAgainstTransaction({
    amount: data.amount,
    existingLinkedAmount: existing._sum.amount ?? 0,
    isManualAdjustment: data.isManualAdjustment,
    transactionAmount: transaction.amount,
    transactionId: data.transactionId
  });
}

async function logActivity(
  db: Prisma.TransactionClient,
  userId: string,
  action:
    | "GOAL_CONTRIBUTION_CREATED"
    | "GOAL_CONTRIBUTION_UPDATED"
    | "GOAL_CONTRIBUTION_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      entityType: "GoalContribution",
      entityId,
      metadata
    }
  });
}

function validateContributionLink(data: ContributionData) {
  if (
    data.type === ContributionType.WITHDRAWAL &&
    data.transactionId
  ) {
    return { ok: false, error: withdrawalTransactionError };
  }

  return { ok: true };
}

function isWriteConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function safeContributionFailure(error: unknown) {
  if (isWriteConflict(error)) {
    return contributionSaveError;
  }

  if (
    error instanceof Error &&
    [
      "Saving goal not found.",
      "Referenced transaction not found.",
      "Referenced money source not found.",
      "Goal contribution not found."
    ].includes(error.message)
  ) {
    return error.message;
  }

  return null;
}

export async function createContribution(
  data: ContributionInput | FormData
): Promise<GoalContributionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseContributionInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid contribution." };
  }

  const contributionData = {
    ...parsed.data,
    userId: user.id
  };

  const linkValidation = validateContributionLink(contributionData);
  if (!linkValidation.ok) {
    return linkValidation;
  }

  try {
    const result = await runSerializable(async (tx) => {
      await verifyReferences(tx, contributionData, user.id);
      const limitValidation = await validateLinkedTransactionLimit(
        tx,
        contributionData
      );

      if (!limitValidation.ok) {
        return {
          ok: false as const,
          error: limitValidation.error ?? overContributionError
        };
      }

      const contribution = await tx.goalContribution.create({
        data: cleanContributionCreateData(contributionData),
        select: {
          id: true,
          savingGoalId: true,
          amount: true,
          type: true
        }
      });

      await logActivity(
        tx,
        user.id,
        "GOAL_CONTRIBUTION_CREATED",
        contribution.id,
        goalContributionCreatedMetadata(contribution)
      );

      return {
        ok: true as const,
        savingGoalId: contribution.savingGoalId
      };
    });

    if (!result.ok) {
      return result;
    }

    revalidatePath("/goals");
    revalidatePath(`/goals/${result.savingGoalId}`);
    return { ok: true };
  } catch (error) {
    const safeError = safeContributionFailure(error);
    if (safeError) {
      return { ok: false, error: safeError };
    }
    throw error;
  }
}

export async function updateContribution(
  id: string,
  data: ContributionUpdateInput | FormData
): Promise<GoalContributionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseContributionUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid contribution." };
  }

  try {
    const result = await runSerializable(async (tx) => {
      const existingContribution = await verifyContributionOwnership(
        tx,
        id,
        user.id
      );
      const nextType = parsed.data.type ?? existingContribution.type;
      const changingToWithdrawal =
        nextType === ContributionType.WITHDRAWAL &&
        existingContribution.type !== ContributionType.WITHDRAWAL;
      const mergedData = {
        savingGoalId:
          parsed.data.savingGoalId ?? existingContribution.savingGoalId,
        transactionId:
          parsed.data.transactionId !== undefined
            ? parsed.data.transactionId
            : changingToWithdrawal
              ? undefined
              : existingContribution.transactionId ?? undefined,
        fromMoneySourceId:
          parsed.data.fromMoneySourceId !== undefined
            ? parsed.data.fromMoneySourceId
            : existingContribution.fromMoneySourceId ?? undefined,
        amount:
          parsed.data.amount !== undefined
            ? parsed.data.amount
            : existingContribution.amount.toString(),
        type: nextType,
        isManualAdjustment:
          parsed.data.isManualAdjustment ??
          existingContribution.isManualAdjustment,
        note:
          parsed.data.note !== undefined
            ? parsed.data.note
            : existingContribution.note ?? undefined,
        contributionDate:
          parsed.data.contributionDate ?? existingContribution.contributionDate,
        userId: user.id
      } satisfies ContributionData & { userId: string };

      const linkValidation = validateContributionLink(mergedData);
      if (!linkValidation.ok) {
        return {
          ok: false as const,
          error: linkValidation.error ?? withdrawalTransactionError
        };
      }

      await verifyReferences(tx, mergedData, user.id);
      const limitValidation = await validateLinkedTransactionLimit(
        tx,
        mergedData,
        id
      );

      if (!limitValidation.ok) {
        return {
          ok: false as const,
          error: limitValidation.error ?? overContributionError
        };
      }

      await tx.goalContribution.updateMany({
        where: { id, userId: user.id },
        data: cleanContributionUpdateData(mergedData)
      });
      const contribution = await verifyContributionOwnership(
        tx,
        id,
        user.id
      );

      await logActivity(
        tx,
        user.id,
        "GOAL_CONTRIBUTION_UPDATED",
        contribution.id,
        goalContributionUpdatedMetadata(existingContribution, contribution)
      );

      return {
        ok: true as const,
        previousSavingGoalId: existingContribution.savingGoalId,
        savingGoalId: contribution.savingGoalId
      };
    });

    if (!result.ok) {
      return result;
    }

    revalidatePath("/goals");
    revalidatePath(`/goals/${result.previousSavingGoalId}`);
    if (result.savingGoalId !== result.previousSavingGoalId) {
      revalidatePath(`/goals/${result.savingGoalId}`);
    }
    return { ok: true };
  } catch (error) {
    const safeError = safeContributionFailure(error);
    if (safeError) {
      return { ok: false, error: safeError };
    }
    throw error;
  }
}

export async function deleteContribution(
  id: string
): Promise<GoalContributionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const savingGoalId = await prisma.$transaction(async (tx) => {
    const contribution = await verifyContributionOwnership(
      tx,
      id,
      user.id
    );
    await tx.goalContribution.deleteMany({
      where: { id, userId: user.id }
    });

    await logActivity(tx, user.id, "GOAL_CONTRIBUTION_DELETED", id, {
      savingGoalId: contribution.savingGoalId,
      amount: contribution.amount.toString(),
      type: contribution.type
    });
    return contribution.savingGoalId;
  });

  revalidatePath("/goals");
  revalidatePath(`/goals/${savingGoalId}`);
  return { ok: true };
}

export async function deleteContributionFormAction(id: string) {
  return deleteContribution(id);
}

export async function listContributionsForGoal(goalId: string) {
  const user = await requireAuth();
  await verifyGoalOwnership(prisma, goalId, user.id);

  return prisma.goalContribution.findMany({
    where: {
      savingGoalId: goalId,
      userId: user.id
    },
    orderBy: { contributionDate: "desc" },
    include: {
      transaction: true,
      fromMoneySource: true
    }
  });
}
