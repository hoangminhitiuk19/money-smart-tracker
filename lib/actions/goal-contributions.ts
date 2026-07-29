"use server";

import { ContributionType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
  overContributionError,
  validateContributionAgainstTransaction
} from "@/lib/calc/goals";
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

const contributionSchema = z.object({
  savingGoalId: z.string().trim().min(1),
  transactionId: optionalIdSchema,
  fromMoneySourceId: optionalIdSchema,
  amount: z.coerce.number().positive(),
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
    transactionId: data.transactionId ?? null,
    fromMoneySourceId: data.fromMoneySourceId ?? null,
    note: data.note ?? null
  };
}

function cleanContributionUpdateData(
  data: ContributionData & { userId: string }
) {
  return {
    ...data,
    transactionId: data.transactionId ?? null,
    fromMoneySourceId: data.fromMoneySourceId ?? null,
    note: data.note ?? null
  };
}

async function verifyGoalOwnership(id: string, userId: string) {
  const goal = await prisma.savingGoal.findFirst({
    where: { id, userId },
    select: { id: true, name: true }
  });

  if (!goal) {
    throw new Error("Saving goal not found.");
  }

  return goal;
}

async function verifyContributionOwnership(id: string, userId: string) {
  const contribution = await prisma.goalContribution.findFirst({
    where: { id, userId }
  });

  if (!contribution) {
    throw new Error("Goal contribution not found.");
  }

  return contribution;
}

async function verifyOptionalTransaction(id: string | undefined, userId: string) {
  if (!id) {
    return null;
  }

  const transaction = await prisma.transaction.findFirst({
    where: { id, userId },
    select: { id: true, amount: true, title: true }
  });

  if (!transaction) {
    throw new Error("Referenced transaction not found.");
  }

  return transaction;
}

async function verifyOptionalMoneySource(id: string | undefined, userId: string) {
  if (!id) {
    return null;
  }

  const moneySource = await prisma.moneySource.findFirst({
    where: { id, userId },
    select: { id: true, name: true }
  });

  if (!moneySource) {
    throw new Error("Referenced money source not found.");
  }

  return moneySource;
}

async function verifyReferences(
  data: Pick<
    ContributionData,
    "fromMoneySourceId" | "savingGoalId" | "transactionId"
  >,
  userId: string
) {
  const [goal, transaction, moneySource] = await Promise.all([
    verifyGoalOwnership(data.savingGoalId, userId),
    verifyOptionalTransaction(data.transactionId, userId),
    verifyOptionalMoneySource(data.fromMoneySourceId, userId)
  ]);

  return { goal, transaction, moneySource };
}

async function validateLinkedTransactionLimit(
  data: ContributionData & { userId: string },
  excludeContributionId?: string
) {
  if (!data.transactionId || data.isManualAdjustment) {
    return { ok: true };
  }

  const transaction = await prisma.transaction.findFirst({
    where: { id: data.transactionId, userId: data.userId },
    select: { amount: true }
  });

  if (!transaction) {
    return { ok: false, error: "Referenced transaction not found." };
  }

  const existing = await prisma.goalContribution.aggregate({
    where: {
      transactionId: data.transactionId,
      userId: data.userId,
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
  userId: string,
  action:
    | "GOAL_CONTRIBUTION_CREATED"
    | "GOAL_CONTRIBUTION_UPDATED"
    | "GOAL_CONTRIBUTION_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await prisma.activityLog.create({
    data: {
      userId,
      action,
      entityType: "GoalContribution",
      entityId,
      metadata
    }
  });
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

  try {
    await verifyReferences(contributionData, user.id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Referenced record not found."
    };
  }

  const limitValidation = await validateLinkedTransactionLimit(contributionData);

  if (!limitValidation.ok) {
    return {
      ok: false,
      error: limitValidation.error ?? overContributionError
    };
  }

  const contribution = await prisma.goalContribution.create({
    data: cleanContributionCreateData(contributionData),
    select: {
      id: true,
      savingGoalId: true,
      amount: true,
      type: true
    }
  });

  await logActivity(user.id, "GOAL_CONTRIBUTION_CREATED", contribution.id, {
    savingGoalId: contribution.savingGoalId,
    amount: contribution.amount.toString(),
    type: contribution.type
  });

  revalidatePath("/goals");
  revalidatePath(`/goals/${contribution.savingGoalId}`);
  return { ok: true };
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
  const existingContribution = await verifyContributionOwnership(id, user.id);
  const parsed = parseContributionUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid contribution." };
  }

  const mergedData = {
    savingGoalId: parsed.data.savingGoalId ?? existingContribution.savingGoalId,
    transactionId:
      parsed.data.transactionId !== undefined
        ? parsed.data.transactionId
        : existingContribution.transactionId ?? undefined,
    fromMoneySourceId:
      parsed.data.fromMoneySourceId !== undefined
        ? parsed.data.fromMoneySourceId
        : existingContribution.fromMoneySourceId ?? undefined,
    amount:
      parsed.data.amount !== undefined
        ? parsed.data.amount
        : Number(existingContribution.amount),
    type: parsed.data.type ?? existingContribution.type,
    isManualAdjustment:
      parsed.data.isManualAdjustment ?? existingContribution.isManualAdjustment,
    note:
      parsed.data.note !== undefined
        ? parsed.data.note
        : existingContribution.note ?? undefined,
    contributionDate:
      parsed.data.contributionDate ?? existingContribution.contributionDate,
    userId: user.id
  } satisfies ContributionData & { userId: string };

  try {
    await verifyReferences(mergedData, user.id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Referenced record not found."
    };
  }

  const limitValidation = await validateLinkedTransactionLimit(mergedData, id);

  if (!limitValidation.ok) {
    return {
      ok: false,
      error: limitValidation.error ?? overContributionError
    };
  }

  await prisma.goalContribution.updateMany({
    where: { id, userId: user.id },
    data: cleanContributionUpdateData(mergedData),
  });
  const contribution = await verifyContributionOwnership(id, user.id);

  await logActivity(user.id, "GOAL_CONTRIBUTION_UPDATED", contribution.id, {
    savingGoalId: contribution.savingGoalId,
    amount: contribution.amount.toString(),
    type: contribution.type
  });

  revalidatePath("/goals");
  revalidatePath(`/goals/${contribution.savingGoalId}`);
  return { ok: true };
}

export async function deleteContribution(
  id: string
): Promise<GoalContributionActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const contribution = await verifyContributionOwnership(id, user.id);

  await prisma.goalContribution.deleteMany({
    where: { id, userId: user.id }
  });

  await logActivity(user.id, "GOAL_CONTRIBUTION_DELETED", id, {
    savingGoalId: contribution.savingGoalId,
    amount: contribution.amount.toString(),
    type: contribution.type
  });

  revalidatePath("/goals");
  revalidatePath(`/goals/${contribution.savingGoalId}`);
  return { ok: true };
}

export async function deleteContributionFormAction(id: string) {
  await deleteContribution(id);
}

export async function listContributionsForGoal(goalId: string) {
  const user = await requireAuth();
  await verifyGoalOwnership(goalId, user.id);

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
